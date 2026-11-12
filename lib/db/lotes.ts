/**
 * Maior número de valores ($1, $2…) que o Postgres aceita num só comando: o
 * protocolo guarda a contagem em 16 bits. Passar disso não dá erro claro — o
 * comando inteiro é recusado com uma mensagem sobre o "bind message".
 */
export const LIMITE_DE_VALORES_DO_POSTGRES = 65_535;

/**
 * Corta a lista em pedaços de até `tamanho` itens, na ordem original. Usado
 * para gravar listas grandes em vários INSERTs, cada um abaixo do limite acima.
 */
export function emLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  if (!Number.isInteger(tamanho) || tamanho < 1) {
    throw new Error(`Tamanho de lote inválido: ${tamanho}`);
  }
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    lotes.push(itens.slice(i, i + tamanho));
  }
  return lotes;
}
