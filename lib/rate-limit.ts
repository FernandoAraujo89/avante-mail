// Rate limit simples por janela fixa (INCR + EXPIRE no Redis).
// Usado nas rotas de autenticação para conter força bruta.
//
// FAIL-OPEN de propósito: se o Redis estiver fora, as requisições passam
// (ferramenta interna — indisponibilidade do Redis não pode trancar todo
// mundo pra fora do sistema). O erro é logado para investigação.

import IORedis from "ioredis";
import type { NextRequest } from "next/server";

let cached: IORedis | undefined;

function getRedis(): IORedis {
  if (!cached) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL não definida.");
    cached = new IORedis(url, {
      // Sem retentativas longas: rate limit não pode segurar a resposta.
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      // Evita ficar reconectando pra sempre em background.
      retryStrategy: (times) => (times > 3 ? null : 200),
    });
    // Sem handler, um erro de conexão vira unhandled error event.
    cached.on("error", () => {});
  }
  return cached;
}

/**
 * Retorna true se a ação PODE prosseguir; false se estourou o limite.
 * `key` deve identificar a ação + o sujeito (ex.: "login:1.2.3.4:a@b.c").
 */
export async function rateLimitAllow(
  key: string,
  max: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    const redis = getRedis();
    const fullKey = `ratelimit:${key}`;
    const count = await redis.incr(fullKey);
    if (count === 1) {
      await redis.expire(fullKey, windowSeconds);
    }
    return count <= max;
  } catch (error) {
    console.error("[RATE-LIMIT] Redis indisponível, liberando:", error);
    return true; // fail-open
  }
}

/** IP do cliente atrás do nginx (X-Forwarded-For) ou direto. */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
