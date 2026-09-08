// Parcelamento do disparo pelo limite diário do tier da Meta.
//
// O limite de mensagens da Meta conta contatos únicos alcançados fora de
// janela de atendimento em 24h móveis, no nível do portfólio. Estourá-lo faz
// o excedente falhar na API — uma rajada de falhas justamente quando a Meta
// está medindo a qualidade do número. Em vez de deixar falhar, o disparo
// fatia a campanha: o que cabe na janela de hoje sai agora, o resto sai em
// lotes de 24 em 24 horas.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Limite diário configurado (WHATSAPP_DAILY_LIMIT); null = sem limite, o
 * parcelamento fica desligado. Deve refletir o tier do portfólio no
 * Gerenciador do WhatsApp, com margem (ex.: tier 10K → 8000).
 */
export function whatsappDailyLimit(): number | null {
  const value = Number(process.env.WHATSAPP_DAILY_LIMIT);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Delay (ms) de cada envio de uma campanha, parcelado pelo limite diário.
 *
 * `usedLast24h` desconta do lote de hoje o que já foi enviado nas últimas
 * 24h ou ainda está na fila. Contar os "na fila" é deliberadamente
 * conservador: entre um lote atrasar 24h e duas campanhas somadas estourarem
 * a janela da Meta, o atraso é o erro barato.
 */
export function planBatchDelays(opts: {
  total: number;
  dailyLimit: number | null;
  usedLast24h: number;
  baseDelayMs: number;
}): number[] {
  const { total, dailyLimit, usedLast24h, baseDelayMs } = opts;
  if (dailyLimit === null || dailyLimit <= 0) {
    return Array.from({ length: total }, () => baseDelayMs);
  }
  const firstBatch = Math.max(0, dailyLimit - Math.max(0, usedLast24h));
  return Array.from({ length: total }, (_, i) => {
    const day =
      i < firstBatch ? 0 : Math.floor((i - firstBatch) / dailyLimit) + 1;
    return baseDelayMs + day * DAY_MS;
  });
}
