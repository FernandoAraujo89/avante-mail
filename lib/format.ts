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

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** Só a hora, no fuso de Brasília: "09:30". */
export function formatTime(value: Date | string): string {
  return timeFormatter.format(new Date(value));
}

// en-CA escreve a data como AAAA-MM-DD: serve de chave de dia e ordena.
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** O dia no fuso de Brasília ("2026-09-14") — para agrupar mensagens por dia. */
export function dayKey(value: Date | string): string {
  return dayKeyFormatter.format(new Date(value));
}

/**
 * Rótulo do dia numa conversa: "Hoje", "Ontem" ou a data. É o dia de
 * Brasília, e não o do navegador: a equipe e os contatos estão no Brasil, e a
 * mensagem das 23h não pode aparecer como "amanhã" para quem abre de fora.
 */
export function formatDayLabel(value: Date | string, now: Date = new Date()): string {
  const key = dayKey(value);
  if (key === dayKey(now)) return "Hoje";
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return "Ontem";
  return formatDate(value);
}

/**
 * Quando algo aconteceu, curto, para listas: a hora se foi hoje, "Ontem", ou
 * a data sem o ano quando é do ano corrente.
 */
export function formatShortWhen(value: Date | string, now: Date = new Date()): string {
  const key = dayKey(value);
  if (key === dayKey(now)) return formatTime(value);
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return "Ontem";
  const [ano, mes, dia] = key.split("-");
  return ano === dayKey(now).slice(0, 4) ? `${dia}/${mes}` : `${dia}/${mes}/${ano}`;
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

// Custos são pequenos (fração de centavo por e-mail); até 4 casas evita
// arredondar um valor real para "0,00".
const usdFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});
const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 4,
});

/** Valor em dólar: 0.0625 → "US$ 0,0625". */
export function formatUsd(value: number): string {
  return usdFormatter.format(value);
}

/** Valor em real: 12.5 → "R$ 12,50". */
export function formatBrl(value: number): string {
  return brlFormatter.format(value);
}
