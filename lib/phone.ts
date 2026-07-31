import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Telefones são armazenados em E.164 (ex.: +5548999999999). Entradas sem DDI
 * são interpretadas como números do Brasil.
 */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(raw, "BR");
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** Formato legível para exibição (ex.: +55 48 99999 9999). */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

/**
 * Extrai o PRIMEIRO telefone válido de um texto que pode conter vários números
 * na mesma célula (comum em planilhas exportadas), ex.:
 *   "91 98121-9276, (91) 98704-2212"      → "+5591981219276"
 *   "19 99676 0536, 19-99676-0536"        → "+5519996760536"
 * Separadores entre números: vírgula, ponto e vírgula, barra, barra vertical e
 * quebras de linha. Hífens, parênteses e espaços DENTRO do número são
 * preservados (fazem parte da formatação). Cada candidato passa pela mesma
 * validação/normalização de normalizePhone. Retorna E.164 ou null.
 */
export function firstValidPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  for (const candidate of value.split(/[,;/|\r\n]+/)) {
    const normalized = normalizePhone(candidate);
    if (normalized) return normalized;
  }
  return null;
}

/** Formato aceito no campo `to` da Cloud API (E.164 sem o "+"). */
export function phoneToWaId(e164: string): string {
  return e164.replace(/^\+/, "");
}

// ─── Casamento de uma lista colada com os contatos já cadastrados ──────────
// A mesma pessoa aparece em formatos incompatíveis: com e sem DDI, com e sem o
// 9 do celular, com máscara. Tudo que varia fica NO COMEÇO do número — por isso
// a comparação é feita do fim para o começo.

/** Quantos dígitos finais dois telefones têm em comum. */
export function commonSuffixDigits(a: string, b: string): number {
  const x = a.replace(/\D/g, "");
  const y = b.replace(/\D/g, "");
  let i = 0;
  while (i < x.length && i < y.length && x[x.length - 1 - i] === y[y.length - 1 - i]) {
    i++;
  }
  return i;
}

/** Mínimo de dígitos finais iguais para considerar que é o mesmo telefone. */
export const MIN_COMMON_DIGITS = 6;

/**
 * Mesmo telefone? Exige MIN_COMMON_DIGITS dígitos finais idênticos — o que já
 * garante os 4 últimos iguais e ainda descarta pares que coincidem só num
 * final curto (dois números diferentes terminados em 0622, por exemplo).
 */
export function samePhone(a: string, b: string): boolean {
  return commonSuffixDigits(a, b) >= MIN_COMMON_DIGITS;
}

/**
 * Telefones de um texto colado (coluna de planilha) ou de um CSV. Cada
 * linha/célula é um candidato; sobra o que tem pelo menos 8 dígitos, o que
 * descarta cabeçalhos, nomes e códigos curtos. Devolve o texto original de
 * cada um (para mostrar de volta ao usuário), sem repetições.
 */
export function parsePhoneList(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const piece of text.split(/[\n\r,;\t|]+/)) {
    const digits = piece.replace(/\D/g, "");
    if (digits.length < 8 || seen.has(digits)) continue;
    seen.add(digits);
    found.push(piece.trim());
  }
  return found;
}
