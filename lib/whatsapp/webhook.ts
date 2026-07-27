import crypto from "crypto";

import type { SendStatus } from "@/lib/db/schema";

// Lógica pura do webhook da Cloud API — sem I/O, para ser testada e revisada
// isoladamente. A rota (app/api/webhooks/whatsapp/route.ts) faz o I/O.

// ─── Assinatura (HMAC-SHA256 do corpo cru com o App Secret) ──────────

export type SignatureCheck =
  | { ok: true }
  | { ok: false; configured: boolean };

/**
 * Confere o header X-Hub-Signature-256 contra o HMAC-SHA256 do corpo cru.
 * Fail-closed: sem WHATSAPP_APP_SECRET, nenhuma requisição é aceita
 * (`configured: false` deixa a rota responder 503 em vez de 401).
 */
export function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string | undefined
): SignatureCheck {
  if (!secret) return { ok: false, configured: false };
  if (!header || !header.startsWith("sha256=")) {
    return { ok: false, configured: true };
  }
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  const received = Buffer.from(header);
  const digest = Buffer.from(expected);
  // timingSafeEqual exige o mesmo tamanho — comparar antes evita exceção.
  const ok =
    received.length === digest.length &&
    crypto.timingSafeEqual(received, digest);
  return ok ? { ok: true } : { ok: false, configured: true };
}

// ─── Descadastro por palavra-chave ───────────────────────────────────

export const WHATSAPP_OPT_OUT_KEYWORDS = [
  "SAIR",
  "PARAR",
  "CANCELAR",
  "DESCADASTRAR",
  "REMOVER",
  "STOP",
  "UNSUBSCRIBE",
];

/** Mensagem de opt-out: a keyword sozinha (tolerando pontuação e acentos). */
export function isOptOutMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos (marcas combinantes)
    .replace(/[.!,;:]/g, "")
    .trim()
    .toUpperCase();
  return WHATSAPP_OPT_OUT_KEYWORDS.includes(normalized);
}

// ─── Transição monotônica de status ──────────────────────────────────

// A ordem dos eventos do webhook NÃO é garantida — o status só avança
// (pending < sent < delivered < read) e um evento atrasado nunca regride.
export const WHATSAPP_STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

export interface CurrentSendState {
  status: SendStatus;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
}

export interface SendStatusPatch {
  status?: SendStatus;
  sentAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface StatusEvent {
  status: string; // sent | delivered | read | failed
  timestamp: Date;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/**
 * Calcula os campos a atualizar em campaign_sends para um evento de status,
 * ou `null` se nada muda. Regras:
 *  - `read` implica `delivered` (preenche deliveredAt junto);
 *  - status só avança; evento fora de ordem não regride, mas ainda preenche
 *    timestamps que faltavam (idempotente);
 *  - `failed` só vale se o envio ainda não teve sucesso confirmado
 *    (delivered/read já são terminais de sucesso).
 */
export function whatsappStatusPatch(
  current: CurrentSendState,
  event: StatusEvent
): SendStatusPatch | null {
  // Já falhou/devolveu: resultado terminal, ignora eventos posteriores.
  if (current.status === "failed" || current.status === "bounced") {
    return null;
  }

  if (event.status === "failed") {
    if (current.status === "delivered" || current.status === "read") {
      return null; // já entregue/lido: não rebaixa para falha
    }
    return {
      status: "failed",
      errorCode: event.errorCode ?? null,
      errorMessage: event.errorMessage ?? null,
    };
  }

  const eventRank = WHATSAPP_STATUS_RANK[event.status];
  if (eventRank === undefined) return null; // status desconhecido

  const currentRank = WHATSAPP_STATUS_RANK[current.status] ?? 0;
  const patch: SendStatusPatch = {};

  if (eventRank > currentRank) {
    patch.status = event.status as SendStatus;
  }

  // Preenche timestamps ausentes (read implica delivered).
  if (event.status === "sent" && !current.sentAt) {
    patch.sentAt = event.timestamp;
  }
  if (
    (event.status === "delivered" || event.status === "read") &&
    !current.deliveredAt
  ) {
    patch.deliveredAt = event.timestamp;
  }
  if (event.status === "read" && !current.readAt) {
    patch.readAt = event.timestamp;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/** Converte o timestamp do webhook (unix em segundos, string) para Date. */
export function parseWebhookTimestamp(value: unknown): Date {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000);
  }
  return new Date();
}
