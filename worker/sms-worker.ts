import "./env";

import { Worker, type Job } from "bullmq";
import { and, count, eq } from "drizzle-orm";

import { campaigns, campaignSends, contacts, getDb } from "../lib/db";
import { createRedisConnection, SMS_QUEUE_NAME, type SmsJobData } from "../lib/queue";
import {
  isRetryableSmsError,
  sendSms,
  shouldMarkSmsOptOut,
  SmsApiError,
} from "../lib/sms/client";
import { getSmsConfig, isSmsEnabled, validateSmsEnv } from "../lib/sms/config";
import { countSms, sanitizeGsm7 } from "../lib/sms/gsm7";
import { errorMessage } from "../lib/utils";

// Worker do canal SMS — espelho do worker/whatsapp-worker.ts, consumindo a
// fila "sms-sends" e chamando a API da Twilio.
//
// A diferença que importa em relação aos outros dois canais: aqui o worker
// grava QUANTO custou (sms_segments). O e-mail cobra por mensagem e o WhatsApp
// por conversa entregue, então basta contar linhas; o SMS cobra por segmento,
// e essa quantidade só é conhecida no momento do envio, depois de transliterar
// o texto.

const INFRA_ENV = ["DATABASE_URL", "REDIS_URL"];
const missingInfra = INFRA_ENV.filter((name) => !process.env[name]);
if (missingInfra.length > 0) {
  console.error(
    `[WORKER-SMS] Variáveis ausentes no .env.local: ${missingInfra.join(", ")}`
  );
  process.exit(1);
}

// Sem o canal ligado (ou com as envs da Twilio pela metade) o worker sobe em
// MODO OCIOSO: não conecta na fila e não processa nada, mas mantém o contêiner
// vivo e saudável — o mesmo padrão do worker de WhatsApp, para o deploy poder
// incluir este serviço antes de a conta Twilio estar pronta.
const smsProblems = isSmsEnabled()
  ? validateSmsEnv()
  : ["TWILIO_SMS_ENABLED não está como \"true\""];

async function processJob(job: Job<SmsJobData>): Promise<void> {
  const { sendId, contactId } = job.data;
  const db = getDb();

  const [send] = await db
    .select()
    .from(campaignSends)
    .where(eq(campaignSends.id, sendId));

  if (!send) {
    throw new Error(`Registro de envio ${sendId} não encontrado.`);
  }
  if (send.status !== "pending") {
    // Job reprocessado após sucesso (ex.: retry por falha de rede no update).
    // Sair aqui é o que impede o contato de receber — e a conta de pagar — a
    // mesma mensagem duas vezes.
    console.log(
      `[WORKER-SMS] Envio ${sendId} já está como "${send.status}", ignorando.`
    );
    return;
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId));

  if (!contact) {
    throw new Error("Contato não encontrado no banco.");
  }

  // Falha definitiva sem retry: grava o motivo e completa o job.
  async function failPermanently(
    code: string | null,
    message: string
  ): Promise<void> {
    console.log(`[WORKER-SMS] ${contact.phone ?? contactId}: ✗ ${message}`);
    await db
      .update(campaignSends)
      .set({ status: "failed", errorCode: code, errorMessage: message })
      .where(eq(campaignSends.id, sendId));
  }

  if (!contact.phone || !contact.smsSubscribed) {
    // Removeu o telefone ou descadastrou depois de entrar na fila. A campanha
    // pode ter sido agendada semanas antes; o consentimento vale o do momento
    // do envio, não o do disparo.
    await failPermanently(
      null,
      "Contato sem telefone ou sem consentimento de SMS."
    );
    return;
  }

  // Texto: da campanha ou do passo de automação (fase 4 — hoje só campanha).
  let body: string;

  if (send.campaignId) {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, send.campaignId));
    if (!campaign) {
      throw new Error("Campanha não encontrada no banco.");
    }
    // O .trim() precisa valer para o texto QUE SAI, não só para a checagem de
    // vazio: a rota de disparo conta os segmentos sobre o texto trimado
    // (send/route.ts), e mandar daqui com um "\n" sobrando faria a mensagem
    // custar um segmento a mais do que o editor prometeu — em toda a base, e
    // sem ninguém entender por quê.
    const texto = campaign.smsBody?.trim();
    if (!texto) {
      await failPermanently(null, "Campanha sem texto de SMS definido.");
      return;
    }
    body = texto;

    // Primeiro job de uma campanha agendada: marca como "sending".
    if (campaign.status === "scheduled") {
      await db
        .update(campaigns)
        .set({ status: "sending" })
        .where(
          and(eq(campaigns.id, campaign.id), eq(campaigns.status, "scheduled"))
        );
    }
  } else {
    await failPermanently(
      null,
      "Envio de SMS sem campanha de origem — o canal ainda não é usado por automação."
    );
    return;
  }

  // Transliteração no último momento possível. Se um emoji sobreviveu até
  // aqui (campanha criada antes desta validação existir, texto alterado por
  // fora), falhar é mais barato que enviar: o emoji joga a mensagem inteira
  // para UCS-2 e triplica a conta sem ninguém perceber.
  const sanitizado = sanitizeGsm7(body);
  if (!sanitizado.ok) {
    const problemas = [...sanitizado.emojis, ...sanitizado.foraDoGsm7].join(" ");
    await failPermanently(
      null,
      `Texto do SMS tem caracteres que o GSM-7 não aceita: ${problemas}`
    );
    return;
  }

  const { segmentos } = countSms(sanitizado.texto);

  let sid: string;
  try {
    ({ sid } = await sendSms({ to: contact.phone, body: sanitizado.texto }));
  } catch (error) {
    if (!isRetryableSmsError(error)) {
      const code =
        error instanceof SmsApiError && error.code !== null
          ? String(error.code)
          : null;
      await failPermanently(code, errorMessage(error));

      // 21610 (destinatário em opt-out na própria Twilio) e 21614 (número
      // inválido ou fixo): marca o contato para nenhuma campanha futura
      // tentar de novo. Reenviar seria pagar para errar a mesma coisa — e no
      // caso do 21610 é a Twilio dizendo que a pessoa mandou PARAR por um
      // caminho que nosso webhook não viu.
      if (shouldMarkSmsOptOut(error)) {
        await db
          .update(contacts)
          .set({ smsSubscribed: false, smsOptOutAt: new Date() })
          .where(eq(contacts.id, contactId));
        console.log(
          `[WORKER-SMS] ${contact.phone} marcado fora do canal SMS (código ${
            error instanceof SmsApiError ? error.code : "?"
          }).`
        );
      }
      return;
    }
    console.log(
      `[WORKER-SMS] Enviando para ${contact.phone}... ✗ (${errorMessage(error)}) — nova tentativa em instantes`
    );
    throw error; // transitório: BullMQ reagenda com backoff
  }

  // DAQUI PARA BAIXO NADA PODE LANÇAR PARA O BULLMQ. A mensagem já saiu e já
  // foi cobrada; um retry não conserta o registro, ele manda — e paga — a
  // mensagem de novo, e o contato recebe o mesmo texto duas vezes. Por isso a
  // gravação tem catch próprio: se o banco piscar exatamente aqui, o envio
  // fica "pending" e a campanha não fecha sozinha, o que é um problema
  // visível e reparável pelo sid abaixo — bem melhor que uma cobrança dupla
  // que ninguém vê.
  try {
    await db
      .update(campaignSends)
      .set({
        status: "sent",
        providerMessageId: sid,
        smsSegments: segmentos,
        sentAt: new Date(),
      })
      .where(eq(campaignSends.id, sendId));

    console.log(
      `[WORKER-SMS] Enviando para ${contact.phone}... ✓ (${segmentos} segmento${segmentos === 1 ? "" : "s"})`
    );
  } catch (updateError) {
    console.error(
      `[WORKER-SMS] ENVIO ${sendId} SAIU (sid ${sid}, ${segmentos} segmento(s)) MAS NÃO FOI GRAVADO: ${errorMessage(updateError)} — ` +
        "reconcilie pelo sid antes de reenviar, a mensagem já foi cobrada."
    );
  }
}

/** Quando não resta nenhum envio pendente, a campanha vira "sent". */
async function finalizeCampaignIfDone(campaignId: string): Promise<void> {
  const db = getDb();

  const [row] = await db
    .select({ pending: count() })
    .from(campaignSends)
    .where(
      and(
        eq(campaignSends.campaignId, campaignId),
        eq(campaignSends.status, "pending")
      )
    );

  if (row.pending === 0) {
    const updated = await db
      .update(campaigns)
      .set({ status: "sent", sentAt: new Date() })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "sending")))
      .returning({ id: campaigns.id, name: campaigns.name });

    if (updated.length > 0) {
      console.log(
        `[WORKER-SMS] Campanha "${updated[0].name}" concluída — status: sent.`
      );
    }
  }
}

function startWorker() {
  // Long code brasileiro entrega ~1 mensagem/s na prática; passar disso só
  // enche a fila da operadora. O teto vem da config (TWILIO_SMS_MAX_SEND_RATE).
  const maxSendRate = getSmsConfig().maxSendRate;

  const worker = new Worker<SmsJobData>(SMS_QUEUE_NAME, processJob, {
    connection: createRedisConnection(),
    concurrency: 5,
    limiter: { max: maxSendRate, duration: 1000 },
  });

  worker.on("completed", async (job) => {
    if (!job.data.campaignId) return;
    try {
      await finalizeCampaignIfDone(job.data.campaignId);
    } catch (error) {
      console.error(
        "[WORKER-SMS] Erro ao finalizar campanha:",
        errorMessage(error)
      );
    }
  });

  worker.on("failed", async (job, error) => {
    if (!job) {
      console.error(
        "[WORKER-SMS] Job desconhecido falhou:",
        errorMessage(error)
      );
      return;
    }

    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      // Esgotou as tentativas: marca o envio como falho.
      try {
        const db = getDb();
        await db
          .update(campaignSends)
          .set({
            status: "failed",
            errorMessage: `Falha após ${attempts} tentativas: ${errorMessage(error)}`,
          })
          .where(
            and(
              eq(campaignSends.id, job.data.sendId),
              eq(campaignSends.status, "pending")
            )
          );
        if (job.data.campaignId) {
          await finalizeCampaignIfDone(job.data.campaignId);
        }
      } catch (updateError) {
        console.error(
          "[WORKER-SMS] Erro ao registrar falha:",
          errorMessage(updateError)
        );
      }
    } else {
      console.log(
        `[WORKER-SMS] Tentativa ${job.attemptsMade}/${attempts} falhou, nova tentativa em instantes...`
      );
    }
  });

  worker.on("error", (error) => {
    console.error(
      "[WORKER-SMS] Erro na conexão com a fila:",
      errorMessage(error)
    );
  });

  console.log(
    `[WORKER-SMS] Campanhas Avante — ouvindo a fila "${SMS_QUEUE_NAME}" (concorrência: 5, limite: ${maxSendRate} msg/s via Twilio)`
  );

  async function shutdown() {
    console.log("\n[WORKER-SMS] Encerrando...");
    await worker.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (smsProblems.length > 0) {
  console.log(
    `[WORKER-SMS] Canal SMS ainda não configurado (${smsProblems.join("; ")}). ` +
      "Modo ocioso — nada será processado até as envs TWILIO_* entrarem no .env.local."
  );
  // Mantém o processo vivo e saudável, sem conectar em nada.
  setInterval(() => {}, 1 << 30);
} else {
  startWorker();
}
