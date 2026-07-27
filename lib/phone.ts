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

/** Formato aceito no campo `to` da Cloud API (E.164 sem o "+"). */
export function phoneToWaId(e164: string): string {
  return e164.replace(/^\+/, "");
}
