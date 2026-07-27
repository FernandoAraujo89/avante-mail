import {
  extractVariables,
  type WhatsAppButton,
  type WhatsAppHeaderType,
  type WhatsAppTemplateStatus,
  type WhatsAppVariableExamples,
} from "./types";

/**
 * Cliente da WhatsApp Cloud API (Graph API da Meta) via fetch nativo — o SDK
 * Node oficial foi arquivado pela Meta, então a integração é direta, no mesmo
 * espírito do lib/ses.ts.
 *
 * Configuração no .env.local (lida de forma lazy: o app sobe sem as envs; só
 * as rotas/worker que chamam a API exigem a configuração):
 *  - WHATSAPP_ACCESS_TOKEN    token permanente (System User) com os escopos
 *                             whatsapp_business_messaging e _management
 *  - WHATSAPP_PHONE_NUMBER_ID id do número remetente (envio de mensagens)
 *  - WHATSAPP_WABA_ID         id da conta WhatsApp Business (templates)
 *  - WHATSAPP_API_VERSION     opcional; padrão v23.0
 */

const GRAPH_BASE = "https://graph.facebook.com";

function apiVersion(): string {
  return process.env.WHATSAPP_API_VERSION || "v23.0";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} não definida no .env.local — configure o canal WhatsApp (Fase 0 do plano).`
    );
  }
  return value;
}

/** Erro da Graph API, preservando o código original da Meta. */
export class WhatsAppApiError extends Error {
  readonly code: number | null;
  readonly subcode: number | null;
  readonly httpStatus: number;
  readonly details: string | null;

  constructor(
    message: string,
    info: {
      code?: number | null;
      subcode?: number | null;
      httpStatus: number;
      details?: string | null;
    }
  ) {
    super(message);
    this.name = "WhatsAppApiError";
    this.code = info.code ?? null;
    this.subcode = info.subcode ?? null;
    this.httpStatus = info.httpStatus;
    this.details = info.details ?? null;
  }
}

interface GraphErrorShape {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
    error_data?: { details?: string };
  };
}

async function graphRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}/${apiVersion()}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireEnv("WHATSAPP_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as T & GraphErrorShape;

  if (!res.ok) {
    const err = json.error;
    throw new WhatsAppApiError(
      err?.error_user_msg ?? err?.message ?? `Graph API respondeu ${res.status}.`,
      {
        code: err?.code ?? null,
        subcode: err?.error_subcode ?? null,
        httpStatus: res.status,
        details: err?.error_data?.details ?? null,
      }
    );
  }
  return json;
}

// ─── Envio de mensagens ──────────────────────────────────────────

export interface TemplateParameter {
  type: "text";
  text: string;
}

export interface TemplateMessageComponent {
  type: "header" | "body";
  parameters: TemplateParameter[];
}

/**
 * Envia uma mensagem de template (única forma de iniciar conversa).
 * `to` em E.164 sem o "+" (ver phoneToWaId em lib/phone.ts).
 * Devolve o wamid — gravado em campaign_sends.provider_message_id para casar
 * os eventos de status do webhook.
 */
export async function sendTemplateMessage(args: {
  to: string;
  templateName: string;
  language: string;
  components?: TemplateMessageComponent[];
}): Promise<{ wamid: string }> {
  const json = await graphRequest<{ messages?: { id: string }[] }>(
    `${requireEnv("WHATSAPP_PHONE_NUMBER_ID")}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: args.to,
        type: "template",
        template: {
          name: args.templateName,
          language: { code: args.language },
          ...(args.components && args.components.length > 0
            ? { components: args.components }
            : {}),
        },
      }),
    }
  );

  const wamid = json.messages?.[0]?.id;
  if (!wamid) {
    throw new Error("Resposta da Cloud API sem o id da mensagem (wamid).");
  }
  return { wamid };
}

/**
 * Mensagem de texto livre — só é entregue dentro da janela de 24h aberta por
 * uma mensagem do contato (usada p/ confirmar o descadastro, Fase 4).
 */
export async function sendTextMessage(args: {
  to: string;
  text: string;
}): Promise<{ wamid: string }> {
  const json = await graphRequest<{ messages?: { id: string }[] }>(
    `${requireEnv("WHATSAPP_PHONE_NUMBER_ID")}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: args.to,
        type: "text",
        text: { body: args.text },
      }),
    }
  );

  const wamid = json.messages?.[0]?.id;
  if (!wamid) {
    throw new Error("Resposta da Cloud API sem o id da mensagem (wamid).");
  }
  return { wamid };
}

// ─── Gestão de templates ─────────────────────────────────────────

/** Componente no formato de criação/leitura de template da Meta. */
export interface MetaTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: string;
  text?: string;
  example?: { body_text?: string[][] };
  buttons?: { type: string; text?: string; url?: string }[];
}

/** Monta os components da Meta a partir do modelo local. */
export function buildTemplateComponents(template: {
  headerType: WhatsAppHeaderType;
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: WhatsAppButton[] | null;
  variableExamples: WhatsAppVariableExamples | null;
}): MetaTemplateComponent[] {
  const components: MetaTemplateComponent[] = [];

  if (template.headerType === "text" && template.headerText) {
    components.push({ type: "HEADER", format: "TEXT", text: template.headerText });
  }

  const body: MetaTemplateComponent = { type: "BODY", text: template.bodyText };
  const indexes = extractVariables(template.bodyText);
  if (indexes.length > 0) {
    // A Meta exige um exemplo por variável para conseguir avaliar o texto.
    body.example = {
      body_text: [
        indexes.map((n) => template.variableExamples?.[String(n)] ?? "exemplo"),
      ],
    };
  }
  components.push(body);

  if (template.footerText) {
    components.push({ type: "FOOTER", text: template.footerText });
  }

  if (template.buttons && template.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: template.buttons.map((b) =>
        b.type === "URL"
          ? { type: "URL", text: b.text, url: b.url }
          : { type: "QUICK_REPLY", text: b.text }
      ),
    });
  }

  return components;
}

export interface CreateTemplateResult {
  id: string;
  status: string;
  category: string;
}

/** Cria o template na Meta (entra em análise). */
export async function createTemplate(args: {
  name: string;
  language: string;
  category: string;
  components: MetaTemplateComponent[];
}): Promise<CreateTemplateResult> {
  return graphRequest<CreateTemplateResult>(
    `${requireEnv("WHATSAPP_WABA_ID")}/message_templates`,
    { method: "POST", body: JSON.stringify(args) }
  );
}

/** Edita um template existente (permitido p/ rejeitados/pausados/aprovados). */
export async function updateTemplate(
  metaTemplateId: string,
  args: { category?: string; components: MetaTemplateComponent[] }
): Promise<void> {
  await graphRequest(`${metaTemplateId}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
}

/** Exclui o template na Meta (todas as línguas com esse nome). */
export async function deleteTemplateByName(name: string): Promise<void> {
  await graphRequest(
    `${requireEnv("WHATSAPP_WABA_ID")}/message_templates?name=${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );
}

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: MetaTemplateComponent[];
  quality_score?: { score?: string };
  rejected_reason?: string;
}

/** Lista todos os templates da WABA (paginação por cursor). */
export async function fetchAllTemplates(): Promise<MetaTemplate[]> {
  const fields =
    "id,name,language,status,category,components,quality_score,rejected_reason";
  const results: MetaTemplate[] = [];
  let after: string | null = null;

  do {
    const params = new URLSearchParams({ fields, limit: "100" });
    if (after) params.set("after", after);
    const json: {
      data?: MetaTemplate[];
      paging?: { cursors?: { after?: string }; next?: string };
    } = await graphRequest(
      `${requireEnv("WHATSAPP_WABA_ID")}/message_templates?${params.toString()}`
    );
    results.push(...(json.data ?? []));
    after = json.paging?.next ? (json.paging?.cursors?.after ?? null) : null;
  } while (after);

  return results;
}

/** As três envs mínimas para enviar mensagens e gerir templates. */
export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_WABA_ID
  );
}

// Erros em que vale tentar de novo (backoff): sobrecarga/limite de vazão.
const TRANSIENT_ERROR_CODES = new Set([
  130429, // Rate limit hit (vazão da Cloud API)
  131000, // Something went wrong (genérico)
  131016, // Service overloaded
  131056, // Pair rate limit (muitas mensagens ao mesmo destinatário)
]);

// Erros em que reenviar NÃO resolve — o envio falha de vez, com o código
// gravado em campaign_sends.error_code (o relatório distingue os motivos).
const PERMANENT_ERROR_CODES = new Set([
  0, // AuthException
  3, // Permissão do app
  10, // Permissão negada
  100, // Parâmetro inválido
  190, // Token expirado/revogado
  131005, // Acesso negado
  131008, // Parâmetro obrigatório ausente
  131009, // Valor de parâmetro inválido
  131021, // Destinatário = remetente
  131026, // Destinatário não pode receber (sem WhatsApp, versão antiga…)
  131031, // Conta bloqueada
  131042, // Problema de pagamento na WABA
  131045, // Número não registrado/assinatura
  131047, // Fora da janela de 24h sem template
  131048, // Número atingiu o limite por spam
  131049, // Limite de marketing do destinatário (esperado em campanhas)
  131051, // Tipo de mensagem não suportado
  132000, // Nº de parâmetros diferente do template
  132001, // Template não existe (nome/idioma)
  132005, // Texto final do template longo demais
  132007, // Conteúdo viola política
  132012, // Formato de parâmetro incompatível
  132015, // Template pausado
  132016, // Template desativado
  133010, // Número não registrado na Cloud API
  368, // Conta temporariamente bloqueada por violação de política
]);

/**
 * Erro permanente de envio: falha o registro sem retry. Transitórios
 * (vazão/5xx/rede) voltam para a fila com backoff.
 */
export function isPermanentSendError(
  error: unknown
): error is WhatsAppApiError {
  if (!(error instanceof WhatsAppApiError)) return false; // rede → transitório
  if (error.code !== null && TRANSIENT_ERROR_CODES.has(error.code)) {
    return false;
  }
  if (error.code !== null && PERMANENT_ERROR_CODES.has(error.code)) {
    return true;
  }
  // Código desconhecido: 4xx tende a ser definitivo; 5xx, passageiro.
  return error.httpStatus < 500;
}

/** Converte o status da Meta (APPROVED, REJECTED…) para o status local. */
export function mapMetaTemplateStatus(status: string): WhatsAppTemplateStatus {
  switch (status.toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "PAUSED":
      return "paused";
    case "DISABLED":
      return "disabled";
    default:
      // PENDING, IN_APPEAL etc. — segue em análise.
      return "pending";
  }
}
