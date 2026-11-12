/**
 * Tag do MOTIVO DA PERDA — o elo entre o CRM e as automações de remarketing
 * (12/11/2026, docs/plano-webhooks-leads.md, "Motivo da perda").
 *
 * O lead perdido carrega a tag "perda: <motivo do CRM>" (uma por motivo, igual
 * ao que está no NRG Hub). A automação de remarketing escuta "Tag adicionada"
 * com essa tag; para tratar vários motivos juntos, ela recebe vários gatilhos.
 *
 * Um lead tem no máximo UMA tag de perda: a do motivo atual. Motivo trocado
 * troca a tag; lead que voltou a ter negócio aberto ou comprou perde a tag.
 *
 * Pura de propósito: a sincronização e o "ligar" da tela usam a mesma regra, e
 * ela é testada sem banco.
 */

export const PREFIXO_DA_TAG_DE_PERDA = "perda: ";

/** Tags muito longas viram ruído no seletor e no gatilho da automação. */
const TAMANHO_MAXIMO = 80;

/**
 * A tag de um motivo, ou null sem motivo.
 *
 * Minúsculas (como toda tag do sistema, `normalizeTags`) e SEM VÍRGULA: a
 * ficha do contato edita as tags como texto separado por vírgula, e "Seguiu
 * todo o fluxo de contato, não tive um retorno" viraria duas tags na primeira
 * edição. A vírgula vira " - ". Ponto final e espaços sobrando caem, para
 * "…retorno." e "…retorno" darem a mesma tag.
 */
export function tagDoMotivo(motivo: string | null | undefined): string | null {
  if (!motivo) return null;
  const limpo = motivo
    .replace(/\s*,\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.;:\-–]+$/u, "")
    .replace(/^[\s\-–]+/u, "")
    .toLowerCase();
  if (!limpo) return null;
  const tag = PREFIXO_DA_TAG_DE_PERDA + limpo;
  return tag.length <= TAMANHO_MAXIMO
    ? tag
    : tag.slice(0, TAMANHO_MAXIMO).trimEnd();
}

export function ehTagDePerda(tag: string): boolean {
  return tag.startsWith(PREFIXO_DA_TAG_DE_PERDA);
}

/**
 * As tags do contato com a tag de perda certa para o motivo: sai toda tag de
 * perda que não for a do motivo atual, entra a dele (se houver). As outras
 * tags ficam intactas, na mesma ordem.
 */
export function tagsComAPerda(
  tags: readonly string[] | null | undefined,
  motivo: string | null
): string[] {
  const alvo = tagDoMotivo(motivo);
  const atuais = tags ?? [];
  const outras = atuais.filter((t) => !ehTagDePerda(t));
  if (!alvo) return outras;
  // Já tinha a tag certa: mantém onde estava, para não reescrever o contato
  // só por causa da ordem.
  if (atuais.includes(alvo)) return atuais.filter((t) => !ehTagDePerda(t) || t === alvo);
  return [...outras, alvo];
}

/** Mesmo conjunto de tags (a ordem não importa). */
export function mesmasTags(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined
): boolean {
  const x = new Set(a ?? []);
  const y = new Set(b ?? []);
  return x.size === y.size && [...x].every((t) => y.has(t));
}
