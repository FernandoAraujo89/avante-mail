import "./env";

import { Worker, type Job } from "bullmq";
import { and, count, eq } from "drizzle-orm";

import {
  campaigns,
  campaignSends,
  contacts,
  getDb,
  whatsappTemplates,
} from "../lib/db";
import { phoneToWaId } from "../lib/phone";
import {
  createRedisConnection,
  WHATSAPP_QUEUE_NAME,
  type WhatsAppJobData,
} from "../lib/queue";
import {
  isPermanentSendError,
  sendTemplateMessage,
} from "../lib/whatsapp/client";
import { buildBodyComponents } from "../lib/whatsapp/variables";
import { errorMessage } from "../lib/utils";

// Worker do canal WhatsApp — espelho do worker/email-worker.ts, consumindo a
// fila "whatsapp-sends" e chamando a Cloud API da Meta.

const INFRA_ENV = ["DATABASE_URL", "REDIS_URL"];
const missingInfra = INFRA_ENV.filter((name) => !process.env[name]);
if (missingInfra.length > 0) {
  console.error(
    `[WORKER-WA] Variáveis ausentes no .env.local: ${missingInfra.join(", ")}`
  );
  process.exit(1);
}

// Sem as envs da Meta o worker sobe em MODO OCIOSO: não conecta na fila e não
// processa nada, mas mantém o contêiner vivo e saudável — assim o deploy pode
// incluir este serviço antes da Fase 0 (conta Meta) sem crash loop e sem
// nenhum efeito sobre o canal de e-mail.
const WHATSAPP_ENV = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"];
const missingWhatsApp = WHATSAPP_ENV.filter((name) => !process.env[name]);

// Mensagens por segundo. O teto técnico da Cloud API é 80/s, mas o gargalo
// real é o limite diário de conversas do tier — 10/s é mais que suficiente.
const MAX_SEND_RATE = Math.max(
  1,
  Number(process.env.WHATSAPP_MAX_SEND_RATE) || 10
);

async function processJob(job: Job<WhatsAppJobData>): Promise<void> {
  const { sendId, campaignId, contactId } = job.data;
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
    console.log(
      `[WORKER-WA] Envio ${sendId} já está como "${send.status}", ignorando.`
    );
    return;
  }

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId));
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId));

  if (!campaign || !contact) {
    throw new Error("Campanha ou contato não encontrado no banco.");
  }

  // Falha definitiva sem retry: grava o motivo e completa o job.
  async function failPermanently(
    code: string | null,
    message: string
  ): Promise<void> {
    console.log(`[WORKER-WA] ${contact.phone ?? contactId}: ✗ ${message}`);
    await db
      .update(campaignSends)
      .set({ status: "failed", errorCode: code, errorMessage: message })
      .where(eq(campaignSends.id, sendId));
  }

  if (!contact.phone || !contact.whatsappSubscribed) {
    // Removeu o telefone ou descadastrou depois de entrar na fila.
    await failPermanently(
      null,
      "Contato sem telefone ou sem consentimento de WhatsApp."
    );
    return;
  }

  if (!campaign.whatsappTemplateId) {
    await failPermanently(null, "Campanha sem modelo de WhatsApp definido.");
    return;
  }
  const [template] = await db
    .select()
    .from(whatsappTemplates)
    .where(eq(whatsappTemplates.id, campaign.whatsappTemplateId));
  if (!template) {
    await failPermanently(null, "Modelo da campanha não existe mais.");
    return;
  }
  if (template.status !== "approved") {
    // Pode ter sido pausado/rejeitado pela Meta depois do disparo.
    await failPermanently(
      null,
      `Modelo "${template.name}" não está aprovado (status: ${template.status}).`
    );
    return;
  }

  // Primeiro job de uma campanha agendada: marca como "sending".
  if (campaign.status === "scheduled") {
    await db
      .update(campaigns)
      .set({ status: "sending" })
      .where(
        and(eq(campaigns.id, campaignId), eq(campaigns.status, "scheduled"))
      );
  }

  try {
    const components = buildBodyComponents({
      bodyText: template.bodyText,
      variables: campaign.whatsappVariables,
      examples: template.variableExamples,
      contact,
    });

    const { wamid } = await sendTemplateMessage({
      to: phoneToWaId(contact.phone),
      templateName: template.name,
      language: template.language,
      components,
    });

    await db
      .update(campaignSends)
      .set({
        status: "sent",
        providerMessageId: wamid,
        sentAt: new Date(),
      })
      .where(eq(campaignSends.id, sendId));

    console.log(`[WORKER-WA] Enviando para ${contact.phone}... ✓`);
  } catch (error) {
    if (isPermanentSendError(error)) {
      // Ex.: 131049 (limite de marketing do destinatário — esperado),
      // 131026 (número sem WhatsApp). Retry não resolve.
      await failPermanently(
        error.code !== null ? String(error.code) : null,
        error.message
      );
      return;
    }
    console.log(
      `[WORKER-WA] Enviando para ${contact.phone}... ✗ (${errorMessage(error)}) — nova tentativa em instantes`
    );
    throw error; // transitório: BullMQ reagenda com backoff
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
      .where(
        and(eq(campaigns.id, campaignId), eq(campaigns.status, "sending"))
      )
      .returning({ id: campaigns.id, name: campaigns.name });

    if (updated.length > 0) {
      console.log(
        `[WORKER-WA] Campanha "${updated[0].name}" concluída — status: sent.`
      );
    }
  }
}

function startWorker() {
  const worker = new Worker<WhatsAppJobData>(WHATSAPP_QUEUE_NAME, processJob, {
    connection: createRedisConnection(),
    concurrency: 5,
    limiter: { max: MAX_SEND_RATE, duration: 1000 },
  });

  worker.on("completed", async (job) => {
    try {
      await finalizeCampaignIfDone(job.data.campaignId);
    } catch (error) {
      console.error(
        "[WORKER-WA] Erro ao finalizar campanha:",
        errorMessage(error)
      );
    }
  });

  worker.on("failed", async (job, error) => {
    if (!job) {
      console.error("[WORKER-WA] Job desconhecido falhou:", errorMessage(error));
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
        await finalizeCampaignIfDone(job.data.campaignId);
      } catch (updateError) {
        console.error(
          "[WORKER-WA] Erro ao registrar falha:",
          errorMessage(updateError)
        );
      }
    } else {
      console.log(
        `[WORKER-WA] Tentativa ${job.attemptsMade}/${attempts} falhou, nova tentativa em instantes...`
      );
    }
  });

  worker.on("error", (error) => {
    console.error(
      "[WORKER-WA] Erro na conexão com a fila:",
      errorMessage(error)
    );
  });

  console.log(
    `[WORKER-WA] Campanhas Avante — ouvindo a fila "${WHATSAPP_QUEUE_NAME}" (concorrência: 5, limite: ${MAX_SEND_RATE} msgs/s via Cloud API)`
  );

  async function shutdown() {
    console.log("\n[WORKER-WA] Encerrando...");
    await worker.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (missingWhatsApp.length > 0) {
  console.log(
    `[WORKER-WA] Canal WhatsApp ainda não configurado (faltam: ${missingWhatsApp.join(", ")}). ` +
      "Modo ocioso — nada será processado até o deploy com as envs da Fase 0."
  );
  // Mantém o processo vivo e saudável, sem conectar em nada.
  setInterval(() => {}, 1 << 30);
} else {
  startWorker();
}
