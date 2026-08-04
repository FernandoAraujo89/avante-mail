import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";

import {
  automationRuns,
  automationRunSteps,
  automations,
  automationSteps,
  automationTriggers,
  automationVersions,
  contactEvents,
  contactLists,
  contacts,
  getDb,
  type AutomationStepType,
  type Contact,
  type ContactEventType,
} from "@/lib/db";
import { emitListDiff, emitTagDiff } from "@/lib/events";

import { avaliarCondicoes } from "./condicoes";
import { enviarEmailDoPasso, enviarWhatsAppDoPasso } from "./envios";

// Motor das automações (docs/plano-automacoes.md, fases 1 e 2).
//
// Duas responsabilidades, propositalmente separadas:
//  - consumirEventos(): lê contact_events pendentes e cria percursos;
//  - avancarPercurso(): executa UM passo de UM contato.
//
// Os passos de envio moram em ./envios.ts — aqui fica só o fluxo.
//
// A fila só despacha; o Postgres é a fonte da verdade. Um "aguarde 2 dias" é
// um job adiado no Redis — se o Redis for perdido, o job some sem erro e a
// automação trava em silêncio. Por isso `next_run_at` espelha o agendamento e
// reconciliarPendentes() reenfileira o que venceu.

/** Teto de passos por percurso — trava contra laço infinito. */
export const TETO_DE_PASSOS = 100;

/** Quanto tempo depois do vencimento a reconciliação assume que o job sumiu. */
const TOLERANCIA_RECONCILIACAO_MS = 60_000;

type Passo = typeof automationSteps.$inferSelect;

// ─── Gatilhos ──────────────────────────────────────────────────────────────

/** O evento satisfaz a configuração do gatilho? */
export function casaGatilho(
  configDoGatilho: Record<string, unknown> | null,
  payloadDoEvento: Record<string, unknown> | null
): boolean {
  // Gatilho sem configuração (ex.: contact_created) casa com qualquer evento
  // do tipo. Com configuração, TODAS as chaves precisam bater.
  if (!configDoGatilho) return true;
  return Object.entries(configDoGatilho).every(
    ([chave, valor]) => payloadDoEvento?.[chave] === valor
  );
}

/**
 * Lê os eventos pendentes, cria os percursos e marca como processados.
 * Devolve quantos eventos consumiu e quantos percursos abriu.
 */
export async function consumirEventos(
  limite = 100
): Promise<{ eventos: number; percursos: string[] }> {
  const db = getDb();

  const pendentes = await db
    .select()
    .from(contactEvents)
    .where(isNull(contactEvents.processedAt))
    .orderBy(asc(contactEvents.createdAt))
    .limit(limite);

  if (pendentes.length === 0) return { eventos: 0, percursos: [] };

  // Gatilhos das automações ATIVAS, na versão corrente de cada uma.
  const gatilhos = await db
    .select({
      automationId: automations.id,
      versionId: automationVersions.id,
      type: automationTriggers.type,
      config: automationTriggers.config,
    })
    .from(automationTriggers)
    .innerJoin(
      automationVersions,
      eq(automationVersions.id, automationTriggers.versionId)
    )
    .innerJoin(
      automations,
      and(
        eq(automations.id, automationVersions.automationId),
        eq(automations.currentVersionId, automationVersions.id)
      )
    )
    .where(eq(automations.status, "active"));

  const percursos: string[] = [];

  for (const evento of pendentes) {
    for (const gatilho of gatilhos) {
      if (gatilho.type !== (evento.type as ContactEventType)) continue;
      if (!casaGatilho(gatilho.config, evento.payload)) continue;
      const criado = await entrarNaAutomacao(
        gatilho.automationId,
        gatilho.versionId,
        evento.contactId
      );
      if (criado) percursos.push(criado);
    }

    await db
      .update(contactEvents)
      .set({ processedAt: new Date() })
      .where(eq(contactEvents.id, evento.id));
  }

  return { eventos: pendentes.length, percursos };
}

/**
 * Coloca o contato na automação. Devolve o id do percurso, ou null se ele já
 * tinha entrado antes — a reentrada é barrada pelo índice único, então evento
 * repetido não vira percurso duplicado.
 */
export async function entrarNaAutomacao(
  automationId: string,
  versionId: string,
  contactId: string
): Promise<string | null> {
  const db = getDb();
  const [criado] = await db
    .insert(automationRuns)
    .values({
      automationId,
      versionId,
      contactId,
      status: "running",
      // Já nasce "vencido para agora": se o processo morrer entre criar o
      // percurso e enfileirá-lo, a reconciliação encontra e retoma. Sem isto
      // o percurso ficaria parado para sempre, sem erro nenhum.
      nextRunAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: automationRuns.id });
  return criado?.id ?? null;
}

// ─── Percurso ──────────────────────────────────────────────────────────────

/** Primeiro passo da versão. */
async function primeiroPasso(versionId: string): Promise<Passo | undefined> {
  const db = getDb();
  const [passo] = await db
    .select()
    .from(automationSteps)
    .where(
      and(
        eq(automationSteps.versionId, versionId),
        isNull(automationSteps.parentId),
        eq(automationSteps.branch, "main")
      )
    )
    .orderBy(asc(automationSteps.position))
    .limit(1);
  return passo;
}

/**
 * Próximo passo depois deste: o irmão seguinte, na mesma ramificação.
 * Ao fim de uma ramificação o percurso termina — ramos não se reencontram.
 */
async function proximoPasso(passo: Passo): Promise<Passo | undefined> {
  const db = getDb();
  const [seguinte] = await db
    .select()
    .from(automationSteps)
    .where(
      and(
        eq(automationSteps.versionId, passo.versionId),
        passo.parentId
          ? eq(automationSteps.parentId, passo.parentId)
          : isNull(automationSteps.parentId),
        eq(automationSteps.branch, passo.branch),
        gt(automationSteps.position, passo.position)
      )
    )
    .orderBy(asc(automationSteps.position))
    .limit(1);
  return seguinte;
}

/**
 * Primeiro passo de um ramo do Se/Então. Ramo vazio (ex.: nada configurado no
 * "não") encerra o percurso — é o mesmo fim de trilho de qualquer ramificação.
 */
async function primeiroFilho(
  passo: Passo,
  branch: "yes" | "no"
): Promise<Passo | undefined> {
  const db = getDb();
  const [filho] = await db
    .select()
    .from(automationSteps)
    .where(
      and(
        eq(automationSteps.versionId, passo.versionId),
        eq(automationSteps.parentId, passo.id),
        eq(automationSteps.branch, branch)
      )
    )
    .orderBy(asc(automationSteps.position))
    .limit(1);
  return filho;
}

/** Milissegundos de espera configurados no passo. */
export function esperaEmMs(config: Record<string, unknown> | null): number {
  const dias = Number(config?.days ?? 0);
  const horas = Number(config?.hours ?? 0);
  const minutos = Number(config?.minutes ?? 0);
  const total =
    (Number.isFinite(dias) ? dias : 0) * 86_400_000 +
    (Number.isFinite(horas) ? horas : 0) * 3_600_000 +
    (Number.isFinite(minutos) ? minutos : 0) * 60_000;
  return Math.max(0, total);
}

async function encerrar(
  runId: string,
  status: "done" | "stopped" | "failed",
  motivo?: string
): Promise<void> {
  await getDb()
    .update(automationRuns)
    .set({
      status,
      stoppedReason: motivo ?? null,
      nextRunAt: null,
      finishedAt: new Date(),
    })
    .where(eq(automationRuns.id, runId));
}

async function registrar(
  runId: string,
  stepId: string,
  status: string,
  result?: Record<string, unknown>
): Promise<void> {
  await getDb()
    .insert(automationRunSteps)
    .values({ runId, stepId, status, result: result ?? null });
}

/** Passo que não fez efeito (ex.: contato sem WhatsApp) fica visível no log. */
function statusDoResultado(resultado: Record<string, unknown>): string {
  return resultado.pulado ? "skipped" : "done";
}

export interface ResultadoDoAvanco {
  /** O que fazer em seguida com este percurso. */
  proximo: "nada" | "imediato" | "adiado";
  /** Atraso em ms quando `proximo` for "adiado". */
  atrasoMs?: number;
  /** Passos já executados DEPOIS deste avanço — compõe o jobId do próximo. */
  passosExecutados: number;
  detalhe: string;
}

/**
 * Executa UM passo do percurso e decide o próximo. Idempotente o suficiente:
 * relê o estado antes de agir, então um job repetido não executa duas vezes.
 */
export async function avancarPercurso(
  runId: string
): Promise<ResultadoDoAvanco> {
  const db = getDb();

  const [run] = await db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.id, runId));

  if (!run) return { proximo: "nada", passosExecutados: 0, detalhe: "percurso não existe" };
  if (run.status === "done" || run.status === "stopped" || run.status === "failed") {
    return { proximo: "nada", passosExecutados: run.stepsExecuted, detalhe: `percurso já ${run.status}` };
  }

  // Descadastrado no meio do fluxo para tudo — decisão registrada no plano.
  const [contato] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, run.contactId));
  if (!contato) {
    await encerrar(runId, "stopped", "contato removido");
    return { proximo: "nada", passosExecutados: run.stepsExecuted, detalhe: "contato removido" };
  }
  // Para só quando o e-mail foi SUPRIMIDO — pedido de saída, devolução
  // definitiva ou reclamação de spam. `subscribed = false` sozinho não basta:
  // significa também "nunca deu aceite", que é o estado de todo lead novo, e
  // parar aí impediria qualquer nutrição de acontecer. Quem não consentiu
  // segue o fluxo; é o passo de ENVIO que recusa.
  if (contato.emailOptOutAt) {
    await encerrar(runId, "stopped", "contato descadastrou");
    return { proximo: "nada", passosExecutados: run.stepsExecuted, detalhe: "contato descadastrou" };
  }

  if (run.stepsExecuted >= TETO_DE_PASSOS) {
    await encerrar(runId, "failed", `teto de ${TETO_DE_PASSOS} passos atingido`);
    return { proximo: "nada", passosExecutados: run.stepsExecuted, detalhe: "teto de passos" };
  }

  const passo = run.currentStepId
    ? (
        await db
          .select()
          .from(automationSteps)
          .where(eq(automationSteps.id, run.currentStepId))
      )[0]
    : await primeiroPasso(run.versionId);

  if (!passo) {
    await encerrar(runId, "done");
    return { proximo: "nada", passosExecutados: run.stepsExecuted, detalhe: "fluxo terminou" };
  }

  // Espera já cumprida: o job adiado voltou, então segue adiante.
  if (passo.type === "wait" && run.status === "waiting") {
    await registrar(runId, passo.id, "done", { espera: "cumprida" });
    return seguirPara(run.id, await proximoPasso(passo), run.stepsExecuted);
  }

  // Espera começando agora.
  if (passo.type === "wait") {
    const atrasoMs = esperaEmMs(passo.config);
    await db
      .update(automationRuns)
      .set({
        status: "waiting",
        currentStepId: passo.id,
        nextRunAt: new Date(Date.now() + atrasoMs),
        stepsExecuted: run.stepsExecuted + 1,
      })
      .where(eq(automationRuns.id, runId));
    return {
      proximo: "adiado",
      atrasoMs,
      passosExecutados: run.stepsExecuted + 1,
      detalhe: `aguardando ${atrasoMs}ms`,
    };
  }

  // Demais passos: executa e segue.
  let resultado: Record<string, unknown>;
  try {
    resultado = await executarPasso(passo, run.id, contato);
    await registrar(runId, passo.id, statusDoResultado(resultado), resultado);
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    await registrar(runId, passo.id, "failed", { erro: mensagem });
    await encerrar(runId, "failed", mensagem);
    return {
      proximo: "nada",
      passosExecutados: run.stepsExecuted,
      detalhe: `passo falhou: ${mensagem}`,
    };
  }

  if (passo.type === "end") {
    await encerrar(runId, "done");
    return { proximo: "nada", passosExecutados: run.stepsExecuted, detalhe: "passo final" };
  }

  // Se/Então: o percurso ENTRA no ramo escolhido (primeiro filho), em vez de
  // seguir para o irmão. Ramos não se reencontram — o fim do ramo é o fim do
  // percurso, e é por isso que o "senão" precisa ser montado por inteiro.
  if (passo.type === "if_else") {
    const ramo = resultado.ramo === "yes" ? "yes" : "no";
    return seguirPara(
      runId,
      await primeiroFilho(passo, ramo),
      run.stepsExecuted
    );
  }

  return seguirPara(runId, await proximoPasso(passo), run.stepsExecuted);
}

async function seguirPara(
  runId: string,
  proximo: Passo | undefined,
  passosExecutados: number
): Promise<ResultadoDoAvanco> {
  if (!proximo) {
    await encerrar(runId, "done");
    return {
      proximo: "nada",
      passosExecutados: passosExecutados,
      detalhe: "fluxo terminou",
    };
  }
  await getDb()
    .update(automationRuns)
    .set({
      status: "running",
      currentStepId: proximo.id,
      // nextRunAt também no "running": é o que permite a reconciliação notar
      // um percurso parado porque o job se perdeu no meio do caminho.
      nextRunAt: new Date(),
      stepsExecuted: passosExecutados + 1,
    })
    .where(eq(automationRuns.id, runId));
  return {
    proximo: "imediato",
    passosExecutados: passosExecutados + 1,
    detalhe: `próximo passo ${proximo.type}`,
  };
}

/**
 * Efeito de cada tipo de passo. Lança para o percurso falhar com motivo.
 * O contato vem carregado de avancarPercurso — é o mesmo que acabou de ter a
 * elegibilidade revalidada, então nenhum passo trabalha sobre estado anterior.
 */
async function executarPasso(
  passo: Passo,
  runId: string,
  contato: Contact
): Promise<Record<string, unknown>> {
  const db = getDb();
  const config = passo.config ?? {};
  const contactId = contato.id;

  switch (passo.type as AutomationStepType) {
    case "end":
      return {};

    // Decide o ramo; quem navega até o filho é avancarPercurso.
    case "if_else":
      return { ...(await avaliarCondicoes({ config: passo.config, contato, runId })) };

    // Envio: grava em campaign_sends e enfileira. O percurso NÃO espera a
    // entrega — o intervalo entre passos é papel do "Aguarde". A elegibilidade
    // do e-mail (subscribed) já foi revalidada no início deste avanço.
    case "send_email":
      return enviarEmailDoPasso({
        runId,
        stepId: passo.id,
        config: passo.config,
        contactId,
      });

    case "send_whatsapp":
      return enviarWhatsAppDoPasso({
        runId,
        stepId: passo.id,
        config: passo.config,
        contactId,
      });

    case "add_tag":
    case "remove_tag": {
      const tag = String(config.tag ?? "").trim().toLowerCase();
      if (!tag) throw new Error("passo de tag sem tag configurada");

      const [contato] = await db
        .select({ tags: contacts.tags })
        .from(contacts)
        .where(eq(contacts.id, contactId));
      const antes = contato?.tags ?? [];
      const depois =
        passo.type === "add_tag"
          ? antes.includes(tag)
            ? antes
            : [...antes, tag]
          : antes.filter((t) => t !== tag);

      if (antes.length !== depois.length) {
        await db
          .update(contacts)
          .set({ tags: depois })
          .where(eq(contacts.id, contactId));
        // A mudança vira evento: é o que permite uma automação alimentar
        // outra — e também o que exige o teto de passos.
        await emitTagDiff(contactId, antes, depois);
      }
      return { tag, mudou: antes.length !== depois.length };
    }

    case "subscribe_list":
    case "unsubscribe_list": {
      const listId = String(config.listId ?? "").trim();
      if (!listId) throw new Error("passo de lista sem lista configurada");

      if (passo.type === "subscribe_list") {
        const inserido = await db
          .insert(contactLists)
          .values({ contactId, listId })
          .onConflictDoNothing()
          .returning({ contactId: contactLists.contactId });
        if (inserido.length > 0) await emitListDiff(contactId, [], [listId]);
        return { listId, mudou: inserido.length > 0 };
      }

      const removido = await db
        .delete(contactLists)
        .where(
          and(
            eq(contactLists.contactId, contactId),
            eq(contactLists.listId, listId)
          )
        )
        .returning({ contactId: contactLists.contactId });
      if (removido.length > 0) await emitListDiff(contactId, [listId], []);
      return { listId, mudou: removido.length > 0 };
    }

    default:
      // update_field e webhook — ainda sem fase marcada no plano.
      throw new Error(
        `passo "${passo.type}" ainda não implementado (ver docs/plano-automacoes.md)`
      );
  }
}

// ─── Reconciliação ─────────────────────────────────────────────────────────

/**
 * Percursos cuja espera venceu e que ninguém retomou — o job adiado do Redis
 * se perdeu. Devolve os ids para o worker reenfileirar.
 */
export async function percursosVencidos(
  limite = 100
): Promise<{ id: string; passosExecutados: number }[]> {
  const db = getDb();
  // Cobre as DUAS formas de o job se perder: durante uma espera ("waiting",
  // next_run_at no futuro) e entre dois passos ("running", next_run_at = agora).
  return db
    .select({
      id: automationRuns.id,
      passosExecutados: automationRuns.stepsExecuted,
    })
    .from(automationRuns)
    .where(
      and(
        inArray(automationRuns.status, ["waiting", "running"]),
        lte(
          automationRuns.nextRunAt,
          new Date(Date.now() - TOLERANCIA_RECONCILIACAO_MS)
        )
      )
    )
    .orderBy(asc(automationRuns.nextRunAt))
    .limit(limite);
}

/** Automações ativas — base do teto de automações simultâneas (5). */
export async function contarAutomacoesAtivas(): Promise<number> {
  const [linha] = await getDb()
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(automations)
    .where(eq(automations.status, "active"));
  return linha?.total ?? 0;
}
