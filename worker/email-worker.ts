import "./env";

import { Worker, type Job } from "bullmq";
import { and, count, eq } from "drizzle-orm";
import { Resend } from "resend";

import {
  campaigns,
  campaignSends,
  contacts,
  getDb,
  templates,
} from "../lib/db";
import { buildCampaignVariables, buildEmailHtml } from "../lib/email";
import {
  createRedisConnection,
  EMAIL_QUEUE_NAME,
  type EmailJobData,
} from "../lib/queue";
import { errorMessage } from "../lib/utils";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "REDIS_URL",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "JWT_SECRET",
  "NEXT_PUBLIC_BASE_URL",
];

const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `[WORKER] Variáveis ausentes no .env.local: ${missing.join(", ")}`
  );
  process.exit(1);
}

const resend = new Resend(process.env.RESEND_API_KEY);

async function processJob(job: Job<EmailJobData>): Promise<void> {
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
      `[WORKER] Envio ${sendId} já está como "${send.status}", ignorando.`
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

  if (!contact.subscribed) {
    // Descadastrou depois de entrar na fila: não envia.
    console.log(
      `[WORKER] ${contact.email} está descadastrado, envio cancelado.`
    );
    await db
      .update(campaignSends)
      .set({ status: "failed" })
      .where(eq(campaignSends.id, sendId));
    return;
  }

  // E-mail da campanha: usa o mjmlContent próprio (design editado). Campanhas
  // antigas sem e-mail próprio caem no template de origem (fallback).
  let mjmlContent = campaign.mjmlContent;
  if (!mjmlContent) {
    if (!campaign.templateId) {
      throw new Error("Campanha sem e-mail montado.");
    }
    const [template] = await db
      .select()
      .from(templates)
      .where(eq(templates.id, campaign.templateId));

    if (!template) {
      throw new Error("Template de origem da campanha não encontrado.");
    }
    mjmlContent = template.mjmlContent;
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
    const variables = await buildCampaignVariables(campaign, contact, sendId);
    const { html, errors } = await buildEmailHtml(
      mjmlContent,
      variables,
      sendId
    );

    if (errors.length > 0) {
      console.warn(`[WORKER] Avisos do MJML: ${errors.join(" | ")}`);
    }

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL as string,
      to: contact.email,
      subject: campaign.subject,
      html,
      headers: {
        // Descadastro em um clique (RFC 8058): o provedor faz POST direto
        // no endpoint, sem o destinatário precisar clicar. Exigido pelas
        // regras de remetente em massa (Gmail/Yahoo) e cobrado pela AWS SES.
        "List-Unsubscribe": `<${variables.list_unsubscribe_url}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    if (error) {
      throw new Error(error.message ?? "Erro desconhecido do Resend.");
    }

    await db
      .update(campaignSends)
      .set({
        status: "sent",
        resendId: data?.id ?? null,
        sentAt: new Date(),
      })
      .where(eq(campaignSends.id, sendId));

    console.log(`[WORKER] Enviando para ${contact.email}... ✓`);
  } catch (error) {
    console.log(
      `[WORKER] Enviando para ${contact.email}... ✗ (${errorMessage(error)})`
    );
    throw error;
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
        `[WORKER] Campanha "${updated[0].name}" concluída — status: sent.`
      );
    }
  }
}

const worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processJob, {
  connection: createRedisConnection(),
  concurrency: 5,
  // O plano gratuito do Resend limita a 2 requisições/segundo.
  limiter: { max: 2, duration: 1000 },
});

worker.on("completed", async (job) => {
  try {
    await finalizeCampaignIfDone(job.data.campaignId);
  } catch (error) {
    console.error("[WORKER] Erro ao finalizar campanha:", errorMessage(error));
  }
});

worker.on("failed", async (job, error) => {
  if (!job) {
    console.error("[WORKER] Job desconhecido falhou:", errorMessage(error));
    return;
  }

  const attempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= attempts) {
    // Esgotou as tentativas: marca o envio como falho.
    try {
      const db = getDb();
      await db
        .update(campaignSends)
        .set({ status: "failed" })
        .where(
          and(
            eq(campaignSends.id, job.data.sendId),
            eq(campaignSends.status, "pending")
          )
        );
      await finalizeCampaignIfDone(job.data.campaignId);
    } catch (updateError) {
      console.error(
        "[WORKER] Erro ao registrar falha:",
        errorMessage(updateError)
      );
    }
  } else {
    console.log(
      `[WORKER] Tentativa ${job.attemptsMade}/${attempts} falhou, nova tentativa em instantes...`
    );
  }
});

worker.on("error", (error) => {
  console.error("[WORKER] Erro na conexão com a fila:", errorMessage(error));
});

console.log(
  `[WORKER] Avante Mail — ouvindo a fila "${EMAIL_QUEUE_NAME}" (concorrência: 5, limite: 2 e-mails/s)`
);

async function shutdown() {
  console.log("\n[WORKER] Encerrando...");
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
