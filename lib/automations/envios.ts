import { and, eq, sql } from "drizzle-orm";

import {
  automationSteps,
  campaignSends,
  contacts,
  getDb,
  templates,
  whatsappTemplates,
  type CampaignChannel,
  type SendStatus,
  type WhatsAppTemplate,
} from "@/lib/db";
import type { SendContent } from "@/lib/email";
import { getEmailQueue, getWhatsAppQueue } from "@/lib/queue";
import { isWhatsAppConfigured } from "@/lib/whatsapp/client";
import type { WhatsAppVariableMap } from "@/lib/whatsapp/types";

// Passos de envio das automações (docs/plano-automacoes.md, fase 2).
//
// O envio da automação grava em campaign_sends, a MESMA tabela das campanhas.
// Com isso entrega, abertura, leitura, descadastro e custo já funcionam: o
// webhook do WhatsApp casa pelo provider_message_id dali, e o rastreio e o
// custo leem dali. Numa tabela separada seria preciso duplicar os quatro.
//
// Este módulo é o único lugar que lê o config de um passo de envio — o motor e
// os dois workers passam por aqui, então o formato do config muda num lugar só.

/** Conteúdo do e-mail de um passo, já resolvido para o worker. */
export interface ConteudoDeEmail {
  subject: string;
  mjmlContent: string;
  /** Variáveis por-destinatário (titulo/subtitulo/corpo/cta). */
  content: SendContent;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * Lê e valida o config de um passo "enviar e-mail". Lança com mensagem clara —
 * o motor transforma isso em percurso falho com o motivo à vista.
 */
export function lerConfigDeEmail(config: Record<string, unknown> | null): {
  subject: string;
  preheader: string | null;
  mjmlContent: string | null;
  templateId: string | null;
  body: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
} {
  const c = config ?? {};
  const subject = texto(c.subject);
  if (!subject) throw new Error("Defina o assunto do e-mail.");

  const mjmlContent = texto(c.mjmlContent);
  const templateId = texto(c.templateId);
  if (!mjmlContent && !templateId) {
    throw new Error("Monte o e-mail deste passo ou escolha um modelo.");
  }

  return {
    subject,
    preheader: texto(c.preheader) || null,
    mjmlContent: mjmlContent || null,
    templateId: templateId || null,
    // Tokens legados ({{corpo}}, {{cta_*}}) — só valem para MJML antigo.
    body: texto(c.body) || null,
    ctaText: texto(c.ctaText) || null,
    ctaUrl: texto(c.ctaUrl) || null,
  };
}

/** Lê e valida o config de um passo "enviar WhatsApp". */
export function lerConfigDeWhatsApp(config: Record<string, unknown> | null): {
  whatsappTemplateId: string;
  variables: WhatsAppVariableMap | null;
} {
  const c = config ?? {};
  const whatsappTemplateId = texto(c.whatsappTemplateId);
  if (!whatsappTemplateId) {
    throw new Error("Escolha o modelo de WhatsApp deste passo.");
  }
  return {
    whatsappTemplateId,
    variables: (c.variables as WhatsAppVariableMap | undefined) ?? null,
  };
}

async function passoPorId(stepId: string) {
  const [passo] = await getDb()
    .select()
    .from(automationSteps)
    .where(eq(automationSteps.id, stepId));
  return passo;
}

/**
 * Conteúdo do e-mail do passo, pronto para o worker compilar.
 * O MJML do próprio passo é a fonte da verdade; templateId é a alternativa,
 * resolvida no momento do envio.
 */
export async function conteudoDoPassoDeEmail(
  stepId: string
): Promise<ConteudoDeEmail> {
  const passo = await passoPorId(stepId);
  if (!passo) throw new Error(`Passo ${stepId} não existe mais.`);

  const cfg = lerConfigDeEmail(passo.config);

  let mjmlContent = cfg.mjmlContent;
  if (!mjmlContent && cfg.templateId) {
    const [template] = await getDb()
      .select({ mjmlContent: templates.mjmlContent })
      .from(templates)
      .where(eq(templates.id, cfg.templateId));
    if (!template) {
      throw new Error("O modelo de e-mail deste passo não existe mais.");
    }
    mjmlContent = template.mjmlContent;
  }
  if (!mjmlContent) throw new Error("Passo de e-mail sem conteúdo montado.");

  return {
    subject: cfg.subject,
    mjmlContent,
    content: {
      titulo: cfg.subject,
      subtitulo: cfg.preheader,
      corpo: cfg.body,
      ctaTexto: cfg.ctaText,
      ctaUrl: cfg.ctaUrl,
    },
  };
}

/** Modelo aprovado e mapa de variáveis do passo de WhatsApp. */
export async function modeloDoPassoDeWhatsApp(stepId: string): Promise<{
  template: WhatsAppTemplate;
  variables: WhatsAppVariableMap | null;
}> {
  const passo = await passoPorId(stepId);
  if (!passo) throw new Error(`Passo ${stepId} não existe mais.`);

  const cfg = lerConfigDeWhatsApp(passo.config);
  const [template] = await getDb()
    .select()
    .from(whatsappTemplates)
    .where(eq(whatsappTemplates.id, cfg.whatsappTemplateId));

  if (!template) throw new Error("O modelo deste passo não existe mais.");
  return { template, variables: cfg.variables };
}

// ─── Registro do envio ─────────────────────────────────────────────────────

interface EnvioDoPasso {
  sendId: string;
  /** Já existia — o job anterior criou e o processo morreu antes de enfileirar. */
  reaproveitado: boolean;
  status: SendStatus;
}

/**
 * Cria (ou recupera) o registro de envio deste passo para este contato.
 *
 * Um passo manda UMA vez por percurso: o índice único parcial garante isso no
 * banco. Recuperar em vez de simplesmente ignorar é o que fecha a janela em que
 * o processo morre depois de gravar o envio e antes de enfileirá-lo — se o
 * registro ficasse "pending" sem job, ninguém receberia nada e não haveria erro.
 */
async function registrarEnvio(args: {
  runId: string;
  stepId: string;
  contactId: string;
  channel: CampaignChannel;
}): Promise<EnvioDoPasso> {
  const db = getDb();

  const [criado] = await db
    .insert(campaignSends)
    .values({
      campaignId: null,
      automationRunId: args.runId,
      automationStepId: args.stepId,
      channel: args.channel,
      contactId: args.contactId,
    })
    .onConflictDoNothing({
      target: [campaignSends.automationRunId, campaignSends.automationStepId],
      where: sql`${campaignSends.automationRunId} is not null`,
    })
    .returning({ id: campaignSends.id });

  if (criado) {
    return { sendId: criado.id, reaproveitado: false, status: "pending" };
  }

  const [existente] = await db
    .select({ id: campaignSends.id, status: campaignSends.status })
    .from(campaignSends)
    .where(
      and(
        eq(campaignSends.automationRunId, args.runId),
        eq(campaignSends.automationStepId, args.stepId)
      )
    );

  if (!existente) {
    // Conflitou mas a linha não está lá: só se alguém a apagou entre as duas
    // consultas. Falhar é melhor do que seguir achando que enviou.
    throw new Error(
      "O registro de envio deste passo desapareceu durante a gravação."
    );
  }
  return {
    sendId: existente.id,
    reaproveitado: true,
    status: existente.status,
  };
}

const OPCOES_DO_JOB = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 3000 },
  removeOnComplete: true,
  removeOnFail: true,
};

/**
 * Passo "enviar e-mail": registra o envio e o enfileira. O percurso NÃO espera
 * a entrega — quem controla o tempo entre passos é o "Aguarde".
 */
export async function enviarEmailDoPasso(args: {
  runId: string;
  stepId: string;
  config: Record<string, unknown> | null;
  contactId: string;
}): Promise<Record<string, unknown>> {
  // Valida antes de gravar: config quebrada falha o percurso sem deixar um
  // registro de envio órfão para trás.
  const cfg = lerConfigDeEmail(args.config);

  // Consentimento na hora do disparo, espelhando o que o WhatsApp já fazia.
  // Antes, quem barrava era a regra de parada do motor; agora que ela só age
  // na supressão, a checagem precisa estar AQUI — senão um lead que nunca deu
  // aceite receberia e-mail. Pulado, não falha: um fluxo com e-mail e
  // WhatsApp continua valendo pelo outro canal.
  const [contato] = await getDb()
    .select({
      subscribed: contacts.subscribed,
      emailOptOutAt: contacts.emailOptOutAt,
    })
    .from(contacts)
    .where(eq(contacts.id, args.contactId));

  if (!contato?.subscribed) {
    return {
      pulado: contato?.emailOptOutAt
        ? "contato descadastrou do e-mail"
        : "contato ainda não deu aceite para e-mail",
    };
  }

  const envio = await registrarEnvio({
    runId: args.runId,
    stepId: args.stepId,
    contactId: args.contactId,
    channel: "email",
  });

  if (envio.reaproveitado && envio.status !== "pending") {
    return { pulado: "e-mail deste passo já enviado", sendId: envio.sendId };
  }

  await getEmailQueue().add(
    "send-email",
    { sendId: envio.sendId, campaignId: null, contactId: args.contactId },
    // jobId pelo envio: reenfileirar o mesmo envio é deduplicado pelo BullMQ.
    { ...OPCOES_DO_JOB, jobId: `auto__${envio.sendId}` }
  );

  return {
    sendId: envio.sendId,
    assunto: cfg.subject,
    reenfileirado: envio.reaproveitado,
  };
}

/**
 * Passo "enviar WhatsApp". Revalida o consentimento do canal na hora do
 * disparo: quem não tem telefone ou pediu para sair é PULADO, não derruba o
 * percurso — um fluxo com e-mail e WhatsApp continua valendo pelo e-mail.
 */
export async function enviarWhatsAppDoPasso(args: {
  runId: string;
  stepId: string;
  config: Record<string, unknown> | null;
  contactId: string;
}): Promise<Record<string, unknown>> {
  const cfg = lerConfigDeWhatsApp(args.config);

  // Elegibilidade primeiro: quem não recebe por WhatsApp é pulado seja qual
  // for o estado da configuração do canal.
  const [contato] = await getDb()
    .select({
      phone: contacts.phone,
      whatsappSubscribed: contacts.whatsappSubscribed,
    })
    .from(contacts)
    .where(eq(contacts.id, args.contactId));

  if (!contato?.phone || !contato.whatsappSubscribed) {
    return { pulado: "contato sem telefone ou sem consentimento de WhatsApp" };
  }

  // Sem as envs da Meta o worker do WhatsApp sobe ocioso: o job ficaria na
  // fila para sempre e o envio nunca sairia, sem erro nenhum. Falhar aqui é o
  // que torna o problema visível.
  if (!isWhatsAppConfigured()) {
    throw new Error(
      "Canal WhatsApp não configurado no servidor (envs WHATSAPP_*)."
    );
  }

  // O modelo é conferido aqui (existe? aprovado?) para o percurso falhar com o
  // motivo à vista, em vez de acumular envios que o worker recusaria um a um.
  const [template] = await getDb()
    .select({ name: whatsappTemplates.name, status: whatsappTemplates.status })
    .from(whatsappTemplates)
    .where(eq(whatsappTemplates.id, cfg.whatsappTemplateId));

  if (!template) throw new Error("O modelo deste passo não existe mais.");
  if (template.status !== "approved") {
    throw new Error(
      `Modelo "${template.name}" não está aprovado (status: ${template.status}).`
    );
  }

  const envio = await registrarEnvio({
    runId: args.runId,
    stepId: args.stepId,
    contactId: args.contactId,
    channel: "whatsapp",
  });

  if (envio.reaproveitado && envio.status !== "pending") {
    return { pulado: "WhatsApp deste passo já enviado", sendId: envio.sendId };
  }

  await getWhatsAppQueue().add(
    "send-whatsapp",
    { sendId: envio.sendId, campaignId: null, contactId: args.contactId },
    { ...OPCOES_DO_JOB, jobId: `auto__${envio.sendId}` }
  );

  return {
    sendId: envio.sendId,
    modelo: template.name,
    reenfileirado: envio.reaproveitado,
  };
}
