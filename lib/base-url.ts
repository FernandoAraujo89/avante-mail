/**
 * URL pública do sistema (sem barra no fim). Mora fora do lib/email.ts porque
 * o canal de WhatsApp também precisa dela — a Meta baixa a mídia do cabeçalho
 * do template por HTTP, então o link tem de ser absoluto.
 */
export function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}
