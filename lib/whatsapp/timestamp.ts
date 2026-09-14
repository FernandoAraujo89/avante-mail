/** Converte o timestamp do webhook (unix em segundos, string) para Date. */
export function parseWebhookTimestamp(value: unknown): Date {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000);
  }
  return new Date();
}
