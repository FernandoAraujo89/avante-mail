// Tipos compartilhados do canal WhatsApp (modelos de mensagem e variáveis).
// Espelham o formato exigido pela Cloud API da Meta para templates.

export const WHATSAPP_TEMPLATE_STATUSES = [
  "draft", // só local, ainda não enviado à Meta
  "pending", // em análise na Meta
  "approved",
  "rejected",
  "paused", // pausado pela Meta (feedback negativo/pacing)
  "disabled",
] as const;
export type WhatsAppTemplateStatus = (typeof WHATSAPP_TEMPLATE_STATUSES)[number];

// AUTHENTICATION existe na Meta, mas tem estrutura fixa (códigos OTP) e não
// se aplica a campanhas — o editor só oferece MARKETING e UTILITY.
export const WHATSAPP_TEMPLATE_CATEGORIES = [
  "MARKETING",
  "UTILITY",
  "AUTHENTICATION",
] as const;
export type WhatsAppTemplateCategory =
  (typeof WHATSAPP_TEMPLATE_CATEGORIES)[number];

export const WHATSAPP_HEADER_TYPES = ["none", "text"] as const;
export type WhatsAppHeaderType = (typeof WHATSAPP_HEADER_TYPES)[number];

export type WhatsAppButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string };

/** Fonte do valor de uma variável {{n}} no envio: campo do contato ou fixo. */
export type WhatsAppVariableSource =
  | { source: "name" }
  | { source: "company" }
  | { source: "static"; value: string };

/** Mapeia o índice da variável ("1", "2"…) para a fonte do valor. */
export type WhatsAppVariableMap = Record<string, WhatsAppVariableSource>;

/** Exemplos de preenchimento ({"1": "Fernando"}) exigidos na aprovação. */
export type WhatsAppVariableExamples = Record<string, string>;

// Limites impostos pela Meta aos componentes do template.
export const WHATSAPP_LIMITS = {
  name: 512,
  headerText: 60,
  body: 1024,
  footerText: 60,
  buttonText: 25,
  buttons: 3,
} as const;

// Nome de template na Meta: minúsculas, números e underscore.
export const WHATSAPP_TEMPLATE_NAME_REGEX = /^[a-z0-9_]+$/;

const VARIABLE_REGEX = /\{\{\s*(\d+)\s*\}\}/g;

/** Índices únicos das variáveis {{n}} de um texto, em ordem crescente. */
export function extractVariables(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(VARIABLE_REGEX)) {
    found.add(Number(match[1]));
  }
  return [...found].sort((a, b) => a - b);
}

/** A Meta exige variáveis sequenciais a partir de {{1}}. */
export function variablesAreSequential(indexes: number[]): boolean {
  return indexes.every((n, i) => n === i + 1);
}

/** Substitui {{n}} pelos valores informados (prévia e montagem do envio). */
export function fillVariables(
  text: string,
  values: Record<string, string>
): string {
  return text.replace(VARIABLE_REGEX, (raw, n: string) => values[n] ?? raw);
}

/**
 * Tarifa da Meta para o Brasil, em US$ por mensagem ENTREGUE, por categoria.
 * Usada só na estimativa de custo do wizard — conferir a tabela vigente
 * (business.whatsapp.com/products/platform-pricing) antes do go-live.
 */
export const WHATSAPP_BRAZIL_PRICE_USD: Record<string, number> = {
  MARKETING: 0.0625,
  UTILITY: 0.0068,
};
