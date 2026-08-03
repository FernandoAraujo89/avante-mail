import "./env";

import { Worker, type Job } from "bullmq";
import { and, count, eq } from "drizzle-orm";

import { conteudoDoPassoDeEmail } from "../lib/automations/envios";
import {
  campaigns,
  campaignSends,
  contacts,
  getDb,
  templates,
  type Contact,
} from "../lib/db";
import {
  buildCampaignVariables,
  buildEmailHtml,
  buildSendVariables,
} from "../lib/email";
import {
  createRedisConnection,
  EMAIL_QUEUE_NAME,
  type EmailJobData,
} from "../lib/queue";
import type { TemplateVariables } from "../lib/render";
import { sendEmail } from "../lib/ses";
import { errorMessage } from "../lib/utils";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "REDIS_URL",
  "SES_SMTP_USER",
  "SES_SMTP_PASSWORD",
  "SES_FROM_EMAIL",
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

// E-mails por segundo. Respeite o limite de envio aprovado no SES — em
// sandbox é 1/s; ajuste SES_MAX_SEND_RATE conforme a cota da conta.
const MAX_SEND_RATE = Math.max(1, Number(process.env.SES_MAX_SEND_RATE) || 10);

/** O que o envio precisa, venha de campanha ou de automação. */
interface ConteudoDoEnvio {
  subject: string;
  mjmlContent: string;
  variables: TemplateVariables;
}

async function conteudoDaCampanha(
  campaignId: string,
  contact: Contact,
  sendId: string
): Promise<ConteudoDoEnvio> {
  const db = getDb();
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId));

  if (!campaign) {
    throw new Error("Campanha não encontrada no banco.");
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

  return {
    subject: campaign.subject,
    mjmlContent,
    variables: await buildCampaignVariables(campaign, contact, sendId),
  };
}

/** Envio de um passo "enviar e-mail" — o conteúdo vem do config do passo. */
async function conteudoDaAutomacao(
  stepId: string | null,
  contact: Contact,
  sendId: string
): Promise<ConteudoDoEnvio> {
  if (!stepId) {
    throw new Error(
      `Envio ${sendId} não tem campanha nem passo de automação de origem.`
    );
  }
  const passo = await conteudoDoPassoDeEmail(stepId);
  return {
    subject: passo.subject,
    mjmlContent: passo.mjmlContent,
    variables: await buildSendVariables(passo.content, contact, sendId),
  };
}

async function processJob(job: Job<EmailJobData>): Promise<void> {
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
    console.log(
      `[WORKER] Envio ${sendId} já está como "${send.status}", ignorando.`
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

  // De onde vem o conteúdo: da campanha ou do passo da automação. O resto do
  // envio (compilação, rastreio, descadastro, gravação) é idêntico nos dois.
  const conteudo = send.campaignId
    ? await conteudoDaCampanha(send.campaignId, contact, sendId)
    : await conteudoDaAutomacao(send.automationStepId, contact, sendId);

  try {
    const { html, errors } = await buildEmailHtml(
      conteudo.mjmlContent,
      conteudo.variables,
      sendId
    );

    if (errors.length > 0) {
      console.warn(`[WORKER] Avisos do MJML: ${errors.join(" | ")}`);
    }

    const { messageId } = await sendEmail({
      to: contact.email,
      subject: conteudo.subject,
      html,
      headers: {
        // Descadastro em um clique (RFC 8058): o provedor faz POST direto
        // no endpoint, sem o destinatário precisar clicar. Exigido pelas
        // regras de remetente em massa (Gmail/Yahoo) e cobrado pela AWS SES.
        "List-Unsubscribe": `<${conteudo.variables.list_unsubscribe_url}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    await db
      .update(campaignSends)
      .set({
        status: "sent",
        providerMessageId: messageId || null,
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
  // Respeita o limite de envio do SES (SES_MAX_SEND_RATE e-mails/segundo).
  limiter: { max: MAX_SEND_RATE, duration: 1000 },
});

worker.on("completed", async (job) => {
  // Envio de automação não fecha campanha nenhuma — cada passo é um envio só.
  if (!job.data.campaignId) return;
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
      if (job.data.campaignId) {
        await finalizeCampaignIfDone(job.data.campaignId);
      }
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
  `[WORKER] Campanhas Avante — ouvindo a fila "${EMAIL_QUEUE_NAME}" (concorrência: 5, limite: ${MAX_SEND_RATE} e-mails/s via SES)`
);

async function shutdown() {
  console.log("\n[WORKER] Encerrando...");
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
