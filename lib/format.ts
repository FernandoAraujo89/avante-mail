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

export const SEGMENT_LABELS: Record<string, string> = {
  todos: "Todos os segmentos",
  white_label: "White Label",
  indicador: "Indicador",
  revenda_fiscal: "Revenda Fiscal",
};

export function segmentLabel(segment: string | null): string {
  if (!segment) return "—";
  return SEGMENT_LABELS[segment] ?? segment;
}

/**
 * Rótulo de uma lista de segmentos de campanha.
 * Vazio/nulo = "Todos os segmentos".
 */
export function segmentsLabel(segments: string[] | null | undefined): string {
  if (!segments || segments.length === 0) return "Todos os segmentos";
  return segments.map((s) => SEGMENT_LABELS[s] ?? s).join(", ");
}
