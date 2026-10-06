import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** E-mail como o sistema guarda: minúsculo e sem espaços nas pontas. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return EMAIL_REGEX.test(email) ? email : null;
}

/**
 * TODOS os e-mails válidos de um texto, normalizados e sem repetição. Célula
 * de planilha com "a@x.com; b@x.com" são dois e-mails do mesmo contato.
 */
export function parseEmailList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const found: string[] = [];
  for (const piece of value.split(/[,;/|\s]+/)) {
    const email = normalizeEmail(piece);
    if (email && !found.includes(email)) found.push(email);
  }
  return found;
}

/** Id de linha (uuid). Conferir antes de consultar evita o 500 do Postgres. */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Normaliza uma lista de IDs (uuid) vinda de string ("a,b") ou array, sem
 * duplicatas nem vazios. Usada para as listas-alvo de uma campanha.
 * Vazio significa "todas as listas".
 */
export function normalizeIds(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.map((s) => String(s).trim())
    : typeof value === "string"
      ? value.split(",").map((s) => s.trim())
      : [];
  return [...new Set(raw.filter(Boolean))];
}
