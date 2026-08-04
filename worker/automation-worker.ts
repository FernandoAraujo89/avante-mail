import "./env";

import { Worker, type Job } from "bullmq";

import {
  avancarPercurso,
  consumirEventos,
  percursosVencidos,
} from "../lib/automations/engine";
import { passagemDiaria, recalcularPendentes } from "../lib/leads/score";
import {
  AUTOMATION_QUEUE_NAME,
  createRedisConnection,
  getAutomationQueue,
  type AutomationJobData,
} from "../lib/queue";
import { errorMessage } from "../lib/utils";

// Worker das automações (docs/plano-automacoes.md, fase 1).
//
// Faz três coisas, em ritmos diferentes:
//  1. consome contact_events e abre percursos (a cada CICLO_MS);
//  2. executa um passo por job da fila "automation-runs";
//  3. reconcilia percursos cuja espera venceu sem o job voltar.
//
// A (3) existe porque um "aguarde 2 dias" é um job adiado no Redis: se o Redis
// for perdido, o job some SEM ERRO e a automação trava em silêncio — o pior
// tipo de falha, porque ninguém percebe. O Postgres guarda next_run_at e este
// laço reenfileira o que venceu.

const INFRA_ENV = ["DATABASE_URL", "REDIS_URL"];
const missingInfra = INFRA_ENV.filter((name) => !process.env[name]);
if (missingInfra.length > 0) {
  console.error(
    `[WORKER-AUTO] Variáveis ausentes no .env.local: ${missingInfra.join(", ")}`
  );
  process.exit(1);
}

/** Intervalo entre varreduras de eventos e de percursos vencidos. */
const CICLO_MS = 10_000;

const queue = getAutomationQueue();

/**
 * Enfileira o avanço de um percurso. O jobId inclui quantos passos já foram
 * executados, então um reenfileiramento do MESMO ponto é deduplicado pelo
 * BullMQ em vez de executar o passo duas vezes.
 */
async function enfileirar(
  runId: string,
  passosExecutados: number,
  atrasoMs = 0
): Promise<void> {
  await queue.add(
    "avancar",
    { runId },
    {
      // Sem ":" — o BullMQ recusa esse caractere no jobId.
      jobId: `${runId}__${passosExecutados}`,
      delay: atrasoMs,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
}

const worker = new Worker<AutomationJobData>(
  AUTOMATION_QUEUE_NAME,
  async (job: Job<AutomationJobData>) => {
    const { runId } = job.data;
    const resultado = await avancarPercurso(runId);

    if (resultado.proximo === "nada") return resultado.detalhe;

    await enfileirar(
      runId,
      resultado.passosExecutados,
      resultado.proximo === "adiado" ? (resultado.atrasoMs ?? 0) : 0
    );
    return resultado.detalhe;
  },
  { connection: createRedisConnection(), concurrency: 5 }
);

worker.on("failed", (job, err) => {
  console.error(
    `[WORKER-AUTO] percurso ${job?.data.runId} falhou: ${errorMessage(err)}`
  );
});

// ─── Laço periódico ────────────────────────────────────────────────────────

let rodando = false;

async function ciclo(): Promise<void> {
  if (rodando) return; // evita sobreposição se um ciclo demorar
  rodando = true;
  try {
    const { eventos, percursos } = await consumirEventos();
    // Percurso recém-aberto começa no passo 0 e precisa do primeiro empurrão.
    for (const runId of percursos) {
      await enfileirar(runId, 0);
    }
    if (percursos.length > 0) {
      console.log(
        `[WORKER-AUTO] ${eventos} evento(s) consumido(s), ${percursos.length} percurso(s) aberto(s)`
      );
    }

    // Percursos cujo job se perdeu — o jobId repete o do original, então se o
    // job ainda existir o BullMQ deduplica em vez de executar duas vezes.
    const vencidos = await percursosVencidos();
    for (const v of vencidos) {
      await enfileirar(v.id, v.passosExecutados);
    }
    if (vencidos.length > 0) {
      console.log(
        `[WORKER-AUTO] ${vencidos.length} percurso(s) vencido(s) reenfileirado(s)`
      );
    }
  } catch (error) {
    console.error(`[WORKER-AUTO] ciclo falhou: ${errorMessage(error)}`);
  }

  // O Lead Score tem try PRÓPRIO: ele só LÊ eventos e grava em contacts, não
  // abre nem avança percurso. Uma falha na pontuação não pode derrubar o ciclo
  // das automações, que é o que move campanha — nem o contrário.
  try {
    const recalculados = await recalcularPendentes();
    if (recalculados > 0) {
      console.log(`[WORKER-AUTO] ${recalculados} lead(s) repontuado(s)`);
    }

    // A passagem completa aplica o DECAIMENTO em quem não teve evento novo —
    // sem ela, lead parado congela no número do último cálculo. Ela mesma
    // decide se já passou o intervalo.
    const passagem = await passagemDiaria();
    if (passagem.rodou) {
      console.log(
        `[WORKER-AUTO] passagem diária do score: ${passagem.recalculados} lead(s)`
      );
    }
  } catch (error) {
    console.error(`[WORKER-AUTO] Lead Score falhou: ${errorMessage(error)}`);
  }

  // Só aqui: a trava cobre o ciclo INTEIRO. Liberá-la antes da pontuação
  // deixaria a passagem diária rodar sobre si mesma num banco grande.
  rodando = false;
}

setInterval(() => void ciclo(), CICLO_MS);
void ciclo();

console.log(
  `[WORKER-AUTO] Campanhas Avante — ouvindo a fila "${AUTOMATION_QUEUE_NAME}" (ciclo: ${CICLO_MS / 1000}s)`
);
