import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normaliza tags vindas de string ("a, b") ou array para string[]. */
export function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((t) => String(t).trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

/** Segmentos válidos de contato/campanha. */
export const VALID_SEGMENTS = [
  "white_label",
  "indicador",
  "revenda_fiscal",
] as const;

/**
 * Normaliza segmentos de uma campanha para string[] com valores válidos,
 * sem duplicatas. Aceita string ("a,b"), array ou "todos" (→ vazio = todos).
 * Vazio significa "todos os segmentos".
 */
export function normalizeSegments(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.map((s) => String(s).trim())
    : typeof value === "string"
      ? value.split(",").map((s) => s.trim())
      : [];

  const valid = raw.filter(
    (s): s is (typeof VALID_SEGMENTS)[number] =>
      (VALID_SEGMENTS as readonly string[]).includes(s)
  );
  return [...new Set(valid)];
}
