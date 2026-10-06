import "./env";

import { Worker, type Job } from "bullmq";
import { and, count, eq } from "drizzle-orm";

import { modeloDoPassoDeWhatsApp } from "../lib/automations/envios";
import { enderecoAceita } from "../lib/contatos/destinatarios";
import {
  campaigns,
  campaignSends,
  contacts,
  getDb,
  whatsappTemplates,
  type WhatsAppTemplate,
} from "../lib/db";
import { phoneToWaId } from "../lib/phone";
import {
  createRedisConnection,
  WHATSAPP_QUEUE_NAME,
  type WhatsAppJobData,
} from "../lib/queue";
import { sendEmail } from "../lib/ses";
import {
  isCircuitBreakerError,
  isPermanentSendError,
  sendTemplateMessage,
  type WhatsAppApiError,
} from "../lib/whatsapp/client";
import {
  missingHeaderMedia,
  type WhatsAppVariableMap,
} from "../lib/whatsapp/types";
import { buildSendComponents } from "../lib/whatsapp/variables";
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
      `[WORKER-WA] Envio ${sendId} já está como "${send.status}", ignorando.`
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

  // Para onde vai: o telefone gravado no envio; nos envios de antes dos
  // endereços múltiplos, o telefone principal do contato.
  const destino = send.address ?? contact.phone;

  // Falha definitiva sem retry: grava o motivo e completa o job.
  async function failPermanently(
    code: string | null,
    message: string
  ): Promise<void> {
    console.log(`[WORKER-WA] ${destino ?? contactId}: ✗ ${message}`);
    await db
      .update(campaignSends)
      .set({ status: "failed", errorCode: code, errorMessage: message })
      .where(eq(campaignSends.id, sendId));
  }

  // Consentimento DESTE número na hora do envio: a campanha pode ter sido
  // agendada semanas antes. Envio antigo, sem endereço: vale o do contato.
  const aceita = destino
    ? send.address
      ? await enderecoAceita(db, "whatsapp", send.address)
      : contact.whatsappSubscribed
    : false;
  if (!destino || !aceita) {
    // Removeu o telefone ou descadastrou depois de entrar na fila.
    await failPermanently(
      null,
      "Contato sem telefone ou sem consentimento de WhatsApp."
    );
    return;
  }

  // Modelo e variáveis: da campanha ou do passo da automação. O envio em si é
  // idêntico nos dois casos.
  let template: WhatsAppTemplate | undefined;
  let variables: WhatsAppVariableMap | null = null;

  if (send.campaignId) {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, send.campaignId));
    if (!campaign) {
      throw new Error("Campanha não encontrada no banco.");
    }
    if (!campaign.whatsappTemplateId) {
      await failPermanently(null, "Campanha sem modelo de WhatsApp definido.");
      return;
    }
    [template] = await db
      .select()
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.id, campaign.whatsappTemplateId));
    variables = campaign.whatsappVariables;

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
    if (!send.automationStepId) {
      await failPermanently(
        null,
        "Envio sem campanha e sem passo de automação de origem."
      );
      return;
    }
    try {
      const passo = await modeloDoPassoDeWhatsApp(send.automationStepId);
      template = passo.template;
      variables = passo.variables;
    } catch (error) {
      // Passo apagado ou config inválida: retry não resolve.
      await failPermanently(null, errorMessage(error));
      return;
    }
  }

  if (!template) {
    await failPermanently(null, "O modelo deste envio não existe mais.");
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

  if (missingHeaderMedia(template)) {
    // Só acontece com modelo mexido por fora; a Cloud API recusaria o envio
    // por falta do parâmetro do cabeçalho, e reenviar não resolveria.
    await failPermanently(
      null,
      `Modelo "${template.name}" tem cabeçalho de arquivo sem a mídia — reenvie o arquivo no modelo.`
    );
    return;
  }

  try {
    const components = buildSendComponents({
      template,
      variables,
      contact,
    });

    const { wamid } = await sendTemplateMessage({
      to: phoneToWaId(destino),
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

    console.log(`[WORKER-WA] Enviando para ${destino}... ✓`);
  } catch (error) {
    if (isPermanentSendError(error)) {
      // Ex.: 131049 (limite de marketing do destinatário — esperado),
      // 131026 (número sem WhatsApp). Retry não resolve.
      await failPermanently(
        error.code !== null ? String(error.code) : null,
        error.message
      );
      if (send.campaignId && isCircuitBreakerError(error)) {
        await tripCircuitBreaker(db, send.campaignId, error);
      }
      return;
    }
    console.log(
      `[WORKER-WA] Enviando para ${destino}... ✗ (${errorMessage(error)}) — nova tentativa em instantes`
    );
    throw error; // transitório: BullMQ reagenda com backoff
  }
}

/**
 * Circuit breaker (docs/plano-campanhas-whatsapp.md, tratamento do 131048):
 * restrição do número/conta derruba TODOS os envios seguintes — interromper o
 * resto da campanha evita centenas de tentativas inúteis contra a API
 * justamente enquanto a Meta está medindo a qualidade do número. Os envios
 * interrompidos ficam como "failed" com o mesmo código, então o relatório
 * explica o que houve e o botão de reenvio retoma quando a conta normalizar.
 * Envio de automação não passa por aqui: é um por contato, sem fila a cortar.
 */
async function tripCircuitBreaker(
  db: ReturnType<typeof getDb>,
  campaignId: string,
  error: WhatsAppApiError
): Promise<void> {
  const code = String(error.code);
  const stopped = await db
    .update(campaignSends)
    .set({
      status: "failed",
      errorCode: code,
      errorMessage: `Interrompido sem tentativa: o erro ${code} atingiu o número durante a campanha.`,
    })
    .where(
      and(
        eq(campaignSends.campaignId, campaignId),
        eq(campaignSends.status, "pending")
      )
    )
    .returning({ id: campaignSends.id });

  if (stopped.length === 0) return;
  console.warn(
    `[WORKER-WA] Circuit breaker: erro ${code} no número — ${stopped.length} envios da campanha ${campaignId} interrompidos.`
  );

  // Alerta por e-mail, como o webhook de qualidade (best-effort).
  const to = process.env.WHATSAPP_ALERT_EMAIL || process.env.SES_FROM_EMAIL;
  if (!to || !process.env.SES_FROM_EMAIL) return;
  try {
    await sendEmail({
      to,
      subject: `Alerta WhatsApp: campanha interrompida (erro ${code})`,
      html: `<p>A Meta restringiu o número durante uma campanha e o restante do disparo foi interrompido para proteger a qualidade.</p>
             <ul><li>Erro: <b>${code}</b> — ${error.message}</li><li>Envios interrompidos: <b>${stopped.length}</b></li></ul>
             <p>Verifique a qualidade no Gerenciador do WhatsApp Business; quando normalizar, use o botão de reenvio no relatório da campanha.</p>`,
    });
  } catch (emailError) {
    console.error(
      "[WORKER-WA] Falha ao enviar alerta do circuit breaker:",
      errorMessage(emailError)
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
    // Envio de automação não fecha campanha nenhuma — cada passo é um envio só.
    if (!job.data.campaignId) return;
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
      console.error(
        "[WORKER-WA] Job desconhecido falhou:",
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
