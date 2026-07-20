import { Queue } from "bullmq";
import IORedis from "ioredis";

export const EMAIL_QUEUE_NAME = "email-sends";

export interface EmailJobData {
  sendId: string;
  campaignId: string;
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
