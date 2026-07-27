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
