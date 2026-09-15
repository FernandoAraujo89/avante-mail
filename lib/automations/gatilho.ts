/**
 * O evento satisfaz a configuração do gatilho?
 *
 * Mora sozinha, sem importar nada, porque duas coisas dependem desta mesma
 * semântica: o motor das automações e as regras do Lead Score
 * (`lib/leads/score.ts`). Dentro de `engine.ts` ela arrastava junto a fila, o
 * WhatsApp e o envio de e-mail para qualquer teste da pontuação.
 */
export function casaGatilho(
  configDoGatilho: Record<string, unknown> | null,
  payloadDoEvento: Record<string, unknown> | null
): boolean {
  // Gatilho sem configuração (ex.: contact_created) casa com qualquer evento
  // do tipo. Com configuração, TODAS as chaves precisam bater.
  if (!configDoGatilho) return true;
  return Object.entries(configDoGatilho).every(
    ([chave, valor]) => payloadDoEvento?.[chave] === valor
  );
}
