const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

export function formatDateTime(value: Date | string | null): string {
  if (!value) return "—";
  return dateTimeFormatter.format(new Date(value));
}

export function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  return dateFormatter.format(new Date(value));
}

export function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1).replace(".", ",")}%`;
}

const numberFormatter = new Intl.NumberFormat("pt-BR");

/** Inteiro com separador de milhar (pt-BR): 12345 → "12.345". */
export function formatInt(value: number): string {
  return numberFormatter.format(Math.round(value));
}

/** Valor já em escala 0–100 formatado com 1 casa: 12.34 → "12,3%". */
export function formatPctValue(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1).replace(".", ",")}%`;
}

/** Divisão segura em escala 0–100 (retorna null se denominador 0). */
export function ratePct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return (numerator / denominator) * 100;
}

/**
 * Rótulo de uma lista de nomes de listas-alvo de campanha.
 * Vazio/nulo = "Todas as listas".
 */
export function listsLabel(names: string[] | null | undefined): string {
  if (!names || names.length === 0) return "Todas as listas";
  return names.join(", ");
}
