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
