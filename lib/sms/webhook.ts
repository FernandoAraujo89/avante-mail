import twilio from "twilio";

import type { SendStatus } from "@/lib/db/schema";

// Lógica pura dos webhooks da Twilio — sem I/O, para ser testada isoladamente.
// As rotas (app/api/webhooks/twilio/*) fazem o I/O. Mesmo desenho do
// lib/whatsapp/webhook.ts.

// ─── Assinatura (X-Twilio-Signature) ─────────────────────────────────

export type SmsSignatureCheck =
  | { ok: true }
  | { ok: false; configured: boolean };

/**
 * Valida a assinatura com o validateRequest do SDK oficial — NUNCA com HMAC
 * próprio: o algoritmo da Twilio tem detalhes (ordenação de params, URL com
 * query) que uma reimplementação erraria em silêncio.
 *
 * Fail-closed: sem TWILIO_AUTH_TOKEN não se aceita requisição nenhuma
 * (`configured: false` deixa a rota responder 503 em vez de 403).
 */
export function verifyTwilioSignature(args: {
  authToken: string | undefined;
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): SmsSignatureCheck {
  if (!args.authToken) return { ok: false, configured: false };
  if (!args.signature) return { ok: false, configured: true };
  const ok = twilio.validateRequest(
    args.authToken,
    args.signature,
    args.url,
    args.params
  );
  return ok ? { ok: true } : { ok: false, configured: true };
}

/**
 * URL pública EXATA que a Twilio assinou. Atrás do proxy reverso o request
 * chega como http://app:3000/...; a assinatura foi calculada sobre
 * https://dominio/... — reconstruir errado rejeitaria 100% dos webhooks.
 * Confia em X-Forwarded-Proto/Host (o Caddy/nginx da frente os define).
 */
export function publicWebhookUrl(args: {
  forwardedProto: string | null;
  forwardedHost: string | null;
  host: string | null;
  pathname: string;
  search: string;
}): string {
  // Proxy pode mandar lista ("https, http") — vale o primeiro (borda externa).
  const proto =
    args.forwardedProto?.split(",")[0]?.trim() ||
    // Sem proxy (dev local), o esquema real é http mesmo.
    "http";
  const host =
    args.forwardedHost?.split(",")[0]?.trim() || args.host || "localhost";
  return `${proto}://${host}${args.pathname}${args.search}`;
}

/** Converte o corpo form-urlencoded em objeto simples para o validateRequest. */
export function formParamsToRecord(form: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [chave, valor] of form.entries()) {
    if (typeof valor === "string") params[chave] = valor;
  }
  return params;
}

// ─── Status callback ─────────────────────────────────────────────────

/**
 * Status da Twilio → status local. queued/sending ainda são "pending" (o
 * envio existe desde antes do job rodar); undelivered e failed são a mesma
 * falha com nomes diferentes (undelivered = a operadora recusou depois do
 * accepted).
 */
export const TWILIO_STATUS_MAP: Record<string, "pending" | "sent" | "delivered" | "failed"> = {
  queued: "pending",
  sending: "pending",
  sent: "sent",
  delivered: "delivered",
  undelivered: "failed",
  failed: "failed",
};

// SMS não tem confirmação de leitura — o ranque para no delivered.
const SMS_STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
};

export interface CurrentSmsSendState {
  status: SendStatus;
  sentAt: Date | null;
  deliveredAt: Date | null;
}

export interface SmsSendPatch {
  status?: SendStatus;
  sentAt?: Date;
  deliveredAt?: Date;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/**
 * Campos a atualizar em campaign_sends para um evento do status callback, ou
 * null se nada muda. Mesmas regras do WhatsApp: a ordem dos eventos não é
 * garantida, então o status só avança e evento atrasado não regride nada —
 * mas ainda preenche timestamp que faltava (idempotente).
 */
export function smsStatusPatch(
  current: CurrentSmsSendState,
  event: { status: string; errorCode?: string | null; timestamp?: Date }
): SmsSendPatch | null {
  const mapped = TWILIO_STATUS_MAP[event.status.toLowerCase()];
  if (!mapped) return null; // status desconhecido (accepted, canceled…)

  // Falha já registrada é terminal.
  if (current.status === "failed" || current.status === "bounced") return null;

  const agora = event.timestamp ?? new Date();

  if (mapped === "failed") {
    if (current.status === "delivered" || current.status === "read") {
      return null; // entregue é terminal de sucesso; não rebaixa
    }
    return {
      status: "failed",
      errorCode: event.errorCode ?? null,
      // O ErrorCode numérico é o dado; mensagem legível fica para o relatório.
      errorMessage: event.errorCode
        ? `Twilio ${event.status} (${event.errorCode})`
        : `Twilio ${event.status}`,
    };
  }

  const eventRank = SMS_STATUS_RANK[mapped];
  const currentRank = SMS_STATUS_RANK[current.status] ?? 0;
  const patch: SmsSendPatch = {};

  if (eventRank > currentRank) patch.status = mapped;
  if (mapped === "sent" && !current.sentAt) patch.sentAt = agora;
  if (mapped === "delivered" && !current.deliveredAt) {
    patch.deliveredAt = agora;
    // Entregue implica enviado — preenche o sentAt se o evento "sent" se perdeu.
    if (!current.sentAt) patch.sentAt = agora;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Códigos que marcam o CONTATO, não só o envio:
 *  21614 — número inválido ou fixo: nunca vai receber;
 *  21610 — destinatário respondeu STOP na Twilio (opt-out do provedor).
 * Nos dois casos, reenviar é pagar para errar de novo.
 */
export const SMS_CONTACT_BLOCK_CODES = new Set(["21610", "21614"]);

export function shouldBlockContact(errorCode: string | null | undefined): boolean {
  return Boolean(errorCode && SMS_CONTACT_BLOCK_CODES.has(errorCode));
}

// ─── Inbound (respostas) ─────────────────────────────────────────────

/**
 * Palavras de opt-out local. A Twilio (Advanced Opt-Out) já bloqueia STOP e
 * variantes do lado dela; aqui registramos o pedido NA NOSSA BASE — o bloqueio
 * do provedor sem o nosso deixaria o painel achando que o contato ainda é
 * alcançável.
 */
export const SMS_OPT_OUT_KEYWORDS = [
  "PARAR",
  "SAIR",
  "CANCELAR",
  "DESCADASTRAR",
  "REMOVER",
  "STOP",
  "UNSUBSCRIBE",
];

/** Mensagem de opt-out: a palavra sozinha, tolerando acento e pontuação. */
export function isSmsOptOutMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalizado = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.!,;:]/g, "")
    .trim()
    .toUpperCase();
  return SMS_OPT_OUT_KEYWORDS.includes(normalizado);
}

/**
 * TwiML vazio: recebemos, não respondemos. A confirmação de opt-out já está
 * configurada no Messaging Service — responder aqui mandaria mensagem em
 * dobro (e cobraria em dobro).
 */
export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
