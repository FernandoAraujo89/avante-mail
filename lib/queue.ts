import { Queue } from "bullmq";
import IORedis from "ioredis";

export const EMAIL_QUEUE_NAME = "email-sends";

export interface EmailJobData {
  sendId: string;
  /** Nulo quando o envio vem de um passo de automação, não de uma campanha. */
  campaignId: string | null;
  contactId: string;
}

/**
 * Redis roda no próprio VPS (localhost, autenticado) — sem teto de uso
 * mensal como o antigo Upstash free tier, que travou a fila ao estourar
 * 500 mil comandos/mês.
 */
export function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL;

  if (!url) {
    throw new Error("REDIS_URL não definida no .env.local.");
  }

  return new IORedis(url, {
    // Exigido pelo BullMQ para comandos bloqueantes.
    maxRetriesPerRequest: null,
  });
}

function createQueue() {
  return new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
}

let cachedQueue: ReturnType<typeof createQueue> | undefined;

export function getEmailQueue() {
  const queue = cachedQueue ?? createQueue();
  cachedQueue = queue;
  return queue;
}

// ─── Fila do canal WhatsApp ──────────────────────────────────────
// Espelho da fila de e-mail: mesma mecânica de delayed jobs/retry, consumida
// pelo worker/whatsapp-worker.ts (processo próprio no compose).

export const WHATSAPP_QUEUE_NAME = "whatsapp-sends";

export interface WhatsAppJobData {
  sendId: string;
  /** Nulo quando o envio vem de um passo de automação, não de uma campanha. */
  campaignId: string | null;
  contactId: string;
}

function createWhatsAppQueue() {
  return new Queue<WhatsAppJobData>(WHATSAPP_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
}

let cachedWhatsAppQueue: ReturnType<typeof createWhatsAppQueue> | undefined;

export function getWhatsAppQueue() {
  const queue = cachedWhatsAppQueue ?? createWhatsAppQueue();
  cachedWhatsAppQueue = queue;
  return queue;
}

// ─── Fila do canal SMS ───────────────────────────────────────────
// Mesma mecânica das outras duas, fila separada por um motivo prático: a
// vazão do SMS é ordens de grandeza menor (long code entrega ~1 msg/s), e uma
// campanha de SMS na fila do e-mail seguraria os e-mails atrás dela.

export const SMS_QUEUE_NAME = "sms-sends";

export interface SmsJobData {
  sendId: string;
  /** Nulo quando o envio vem de um passo de automação, não de uma campanha. */
  campaignId: string | null;
  contactId: string;
}

function createSmsQueue() {
  return new Queue<SmsJobData>(SMS_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
}

let cachedSmsQueue: ReturnType<typeof createSmsQueue> | undefined;

export function getSmsQueue() {
  const queue = cachedSmsQueue ?? createSmsQueue();
  cachedSmsQueue = queue;
  return queue;
}

// ─── Fila das automações ─────────────────────────────────────────
// Um job = um passo de um contato. A espera ("Aguarde 2 dias") é um job
// adiado, a mesma mecânica do agendamento de campanha.
// ATENÇÃO: o Redis aqui é só o despachante. Quem manda é automation_runs no
// Postgres — ver reconciliarPendentes no worker.

export const AUTOMATION_QUEUE_NAME = "automation-runs";

export interface AutomationJobData {
  runId: string;
}

function createAutomationQueue() {
  return new Queue<AutomationJobData>(AUTOMATION_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
}

let cachedAutomationQueue: ReturnType<typeof createAutomationQueue> | undefined;

export function getAutomationQueue() {
  const queue = cachedAutomationQueue ?? createAutomationQueue();
  cachedAutomationQueue = queue;
  return queue;
}
