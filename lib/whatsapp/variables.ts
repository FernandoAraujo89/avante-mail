import type { TemplateMessageComponent } from "./client";
import {
  extractVariables,
  type WhatsAppVariableExamples,
  type WhatsAppVariableMap,
} from "./types";

// Resolve os valores das variáveis {{n}} de um envio: cada índice vem do
// mapeamento da campanha (campo do contato ou texto fixo). Usado pelo worker
// e pelo envio de teste.

export interface VariableContact {
  name: string;
  company: string | null;
}

export function resolveVariables(args: {
  bodyText: string;
  variables: WhatsAppVariableMap | null;
  examples: WhatsAppVariableExamples | null;
  contact: VariableContact;
}): Record<string, string> {
  const values: Record<string, string> = {};
  for (const n of extractVariables(args.bodyText)) {
    const key = String(n);
    const source = args.variables?.[key];
    let value = "";
    if (source?.source === "name") value = args.contact.name;
    else if (source?.source === "company") value = args.contact.company ?? "";
    else if (source?.source === "static") value = source.value ?? "";
    // Sem valor (ex.: contato sem empresa): cai no exemplo do modelo — a
    // Cloud API rejeita parâmetro vazio.
    if (!value.trim()) value = args.examples?.[key] ?? "-";
    // A Meta rejeita parâmetros com quebras de linha, tabs ou 4+ espaços.
    values[key] = value.replace(/\s+/g, " ").trim();
  }
  return values;
}

/** Monta o componente `body` do payload de envio (vazio se não há variáveis). */
export function buildBodyComponents(args: {
  bodyText: string;
  variables: WhatsAppVariableMap | null;
  examples: WhatsAppVariableExamples | null;
  contact: VariableContact;
}): TemplateMessageComponent[] {
  const indexes = extractVariables(args.bodyText);
  if (indexes.length === 0) return [];
  const values = resolveVariables(args);
  return [
    {
      type: "body",
      parameters: indexes.map((n) => ({
        type: "text",
        text: values[String(n)],
      })),
    },
  ];
}

/**
 * Variáveis do modelo sem fonte definida no mapeamento da campanha (ou fonte
 * "texto fixo" sem valor). Validado antes do disparo.
 */
export function missingVariableSources(
  bodyText: string,
  variables: WhatsAppVariableMap | null
): number[] {
  return extractVariables(bodyText).filter((n) => {
    const source = variables?.[String(n)];
    if (!source) return true;
    return source.source === "static" && !source.value?.trim();
  });
}
