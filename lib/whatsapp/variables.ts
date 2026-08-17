import { getBaseUrl } from "../base-url";
import type { TemplateMessageComponent } from "./client";
import {
  extractVariables,
  isMediaHeader,
  type WhatsAppHeaderType,
  type WhatsAppVariableExamples,
  type WhatsAppVariableMap,
} from "./types";

// Monta os componentes de um envio: o cabeçalho de mídia (quando o modelo tem
// imagem ou PDF) e o corpo com as variáveis {{n}} resolvidas — cada índice vem
// do mapeamento da campanha (campo do contato ou texto fixo). Usado pelo worker
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

/** O que um envio precisa saber do modelo aprovado. */
export interface SendTemplate {
  bodyText: string;
  variableExamples: WhatsAppVariableExamples | null;
  headerType: WhatsAppHeaderType;
  headerMediaUrl: string | null;
  headerMediaFilename: string | null;
}

/**
 * Componentes do payload de envio: cabeçalho de mídia (se houver) e corpo com
 * as variáveis (vazio quando o modelo não tem nem um nem outro).
 *
 * O arquivo do cabeçalho vai como link absoluto — a Meta baixa a mídia a cada
 * envio, então /uploads precisa estar acessível na NEXT_PUBLIC_BASE_URL.
 */
export function buildSendComponents(args: {
  template: SendTemplate;
  variables: WhatsAppVariableMap | null;
  contact: VariableContact;
}): TemplateMessageComponent[] {
  const { template } = args;
  const components: TemplateMessageComponent[] = [];

  if (isMediaHeader(template.headerType) && template.headerMediaUrl) {
    const link = /^https?:\/\//.test(template.headerMediaUrl)
      ? template.headerMediaUrl
      : `${getBaseUrl()}${template.headerMediaUrl}`;
    components.push({
      type: "header",
      parameters: [
        template.headerType === "image"
          ? { type: "image", image: { link } }
          : {
              type: "document",
              document: {
                link,
                // Nome que aparece no card do PDF na conversa.
                ...(template.headerMediaFilename
                  ? { filename: template.headerMediaFilename }
                  : {}),
              },
            },
      ],
    });
  }

  const indexes = extractVariables(template.bodyText);
  if (indexes.length > 0) {
    const values = resolveVariables({
      bodyText: template.bodyText,
      variables: args.variables,
      examples: template.variableExamples,
      contact: args.contact,
    });
    components.push({
      type: "body",
      parameters: indexes.map((n) => ({
        type: "text",
        text: values[String(n)],
      })),
    });
  }

  return components;
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
