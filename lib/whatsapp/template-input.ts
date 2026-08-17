import { uploadNameFromUrl } from "../uploads";
import {
  extractVariables,
  isMediaHeader,
  parseHeaderType,
  variablesAreSequential,
  WHATSAPP_LIMITS,
  WHATSAPP_MEDIA_HEADERS,
  WHATSAPP_TEMPLATE_NAME_REGEX,
  type WhatsAppButton,
  type WhatsAppHeaderType,
  type WhatsAppTemplateCategory,
  type WhatsAppVariableExamples,
  type WhatsAppVariableMap,
} from "./types";

// Validação do payload de criação/edição de modelo (rotas da API). Os limites
// espelham as regras da Meta para o template ser aceito na análise.

export interface WhatsAppTemplateInput {
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  headerType: WhatsAppHeaderType;
  headerText: string | null;
  headerMediaUrl: string | null;
  headerMediaFilename: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: WhatsAppButton[] | null;
  variableExamples: WhatsAppVariableExamples | null;
}

export type ParseTemplateResult =
  | { ok: true; data: WhatsAppTemplateInput }
  | { ok: false; error: string };

const LANGUAGE_REGEX = /^[a-z]{2}(_[A-Z]{2})?$/;
const HAS_VARIABLE_REGEX = /\{\{/;

function fail(error: string): ParseTemplateResult {
  return { ok: false, error };
}

export function parseTemplateInput(body: unknown): ParseTemplateResult {
  const data = (body ?? {}) as Record<string, unknown>;

  const name =
    typeof data.name === "string" ? data.name.trim().toLowerCase() : "";
  if (!name) return fail("O nome do modelo é obrigatório.");
  if (!WHATSAPP_TEMPLATE_NAME_REGEX.test(name)) {
    return fail(
      "O nome do modelo deve ter apenas letras minúsculas, números e _ (ex.: promo_julho)."
    );
  }
  if (name.length > WHATSAPP_LIMITS.name) {
    return fail(`O nome pode ter no máximo ${WHATSAPP_LIMITS.name} caracteres.`);
  }

  const language =
    typeof data.language === "string" && data.language.trim()
      ? data.language.trim()
      : "pt_BR";
  if (!LANGUAGE_REGEX.test(language)) {
    return fail("Idioma inválido. Use o código da Meta (ex.: pt_BR).");
  }

  const category = data.category;
  if (category !== "MARKETING" && category !== "UTILITY") {
    return fail("Categoria inválida. Use MARKETING ou UTILITY.");
  }

  const headerType: WhatsAppHeaderType = parseHeaderType(data.headerType);
  let headerText: string | null = null;
  let headerMediaUrl: string | null = null;
  let headerMediaFilename: string | null = null;

  if (headerType === "text") {
    headerText =
      typeof data.headerText === "string" ? data.headerText.trim() : "";
    if (!headerText) {
      return fail("Informe o texto do cabeçalho (ou remova o cabeçalho).");
    }
    if (headerText.length > WHATSAPP_LIMITS.headerText) {
      return fail(
        `O cabeçalho pode ter no máximo ${WHATSAPP_LIMITS.headerText} caracteres.`
      );
    }
    if (HAS_VARIABLE_REGEX.test(headerText)) {
      return fail("Variáveis no cabeçalho não são suportadas.");
    }
  } else if (isMediaHeader(headerType)) {
    const rawUrl =
      typeof data.headerMediaUrl === "string" ? data.headerMediaUrl.trim() : "";
    if (!rawUrl) {
      return fail(
        headerType === "image"
          ? "Envie a imagem do cabeçalho (ou remova o cabeçalho)."
          : "Envie o PDF do cabeçalho (ou remova o cabeçalho)."
      );
    }
    // Só arquivos que passaram pelo nosso upload: é deles que sai a amostra
    // mandada à análise da Meta, com os mesmos bytes que ela baixa no envio.
    const uploadName = uploadNameFromUrl(rawUrl);
    if (!uploadName) {
      return fail("Arquivo do cabeçalho inválido — envie o arquivo novamente.");
    }
    const ext = uploadName.split(".").pop()!.toLowerCase();
    if (!WHATSAPP_MEDIA_HEADERS[headerType].types[ext]) {
      return fail(
        headerType === "image"
          ? "No cabeçalho de imagem a Meta aceita só JPG ou PNG."
          : "No cabeçalho de documento a Meta aceita só PDF."
      );
    }
    headerMediaUrl = rawUrl;
    headerMediaFilename =
      typeof data.headerMediaFilename === "string" &&
      data.headerMediaFilename.trim()
        ? data.headerMediaFilename.trim().slice(0, 120)
        : uploadName;
  }

  const bodyText =
    typeof data.bodyText === "string" ? data.bodyText.trim() : "";
  if (!bodyText) return fail("O corpo da mensagem é obrigatório.");
  if (bodyText.length > WHATSAPP_LIMITS.body) {
    return fail(
      `O corpo pode ter no máximo ${WHATSAPP_LIMITS.body} caracteres.`
    );
  }
  const variables = extractVariables(bodyText);
  if (!variablesAreSequential(variables)) {
    return fail(
      "As variáveis do corpo devem ser sequenciais a partir de {{1}} ({{1}}, {{2}}…)."
    );
  }

  let footerText: string | null =
    typeof data.footerText === "string" && data.footerText.trim()
      ? data.footerText.trim()
      : null;
  if (footerText) {
    if (footerText.length > WHATSAPP_LIMITS.footerText) {
      return fail(
        `O rodapé pode ter no máximo ${WHATSAPP_LIMITS.footerText} caracteres.`
      );
    }
    if (HAS_VARIABLE_REGEX.test(footerText)) {
      return fail("Variáveis no rodapé não são suportadas.");
    }
  } else {
    footerText = null;
  }

  let buttons: WhatsAppButton[] | null = null;
  if (Array.isArray(data.buttons) && data.buttons.length > 0) {
    if (data.buttons.length > WHATSAPP_LIMITS.buttons) {
      return fail(`Use no máximo ${WHATSAPP_LIMITS.buttons} botões.`);
    }
    const parsed: WhatsAppButton[] = [];
    let urlCount = 0;
    for (const raw of data.buttons) {
      const b = (raw ?? {}) as Record<string, unknown>;
      const text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text) return fail("Todo botão precisa de um texto.");
      if (text.length > WHATSAPP_LIMITS.buttonText) {
        return fail(
          `O texto do botão pode ter no máximo ${WHATSAPP_LIMITS.buttonText} caracteres.`
        );
      }
      if (b.type === "URL") {
        const buttonUrl = typeof b.url === "string" ? b.url.trim() : "";
        if (!/^https?:\/\//.test(buttonUrl)) {
          return fail("Informe uma URL válida (https://…) no botão de link.");
        }
        urlCount++;
        if (urlCount > 2) {
          return fail("Use no máximo 2 botões de link (limite da Meta).");
        }
        parsed.push({ type: "URL", text, url: buttonUrl });
      } else if (b.type === "QUICK_REPLY") {
        parsed.push({ type: "QUICK_REPLY", text });
      } else {
        return fail("Tipo de botão inválido. Use QUICK_REPLY ou URL.");
      }
    }
    buttons = parsed;
  }

  // Guarda só os exemplos das variáveis que existem no corpo.
  let variableExamples: WhatsAppVariableExamples | null = null;
  if (variables.length > 0) {
    const rawExamples =
      data.variableExamples && typeof data.variableExamples === "object"
        ? (data.variableExamples as Record<string, unknown>)
        : {};
    const examples: WhatsAppVariableExamples = {};
    for (const n of variables) {
      const value = rawExamples[String(n)];
      if (typeof value === "string" && value.trim()) {
        examples[String(n)] = value.trim();
      }
    }
    variableExamples = Object.keys(examples).length > 0 ? examples : null;
  }

  return {
    ok: true,
    data: {
      name,
      language,
      category,
      headerType,
      headerText,
      headerMediaUrl,
      headerMediaFilename,
      bodyText,
      footerText,
      buttons,
      variableExamples,
    },
  };
}

/**
 * Variáveis do corpo sem exemplo preenchido — a Meta exige um exemplo por
 * variável para aceitar o template na análise (validado no envio, não no
 * rascunho).
 */
export function missingExamples(input: {
  bodyText: string;
  variableExamples: WhatsAppVariableExamples | null;
}): number[] {
  return extractVariables(input.bodyText).filter(
    (n) => !input.variableExamples?.[String(n)]?.trim()
  );
}

/**
 * Valida o mapa de variáveis de uma campanha ({"1": {"source": "name"}}).
 * Entradas desconhecidas são descartadas; vazio vira null.
 */
export function parseVariableMap(value: unknown): WhatsAppVariableMap | null {
  if (!value || typeof value !== "object") return null;
  const out: WhatsAppVariableMap = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d+$/.test(key)) continue;
    const source = (raw ?? {}) as Record<string, unknown>;
    if (source.source === "name") {
      out[key] = { source: "name" };
    } else if (source.source === "company") {
      out[key] = { source: "company" };
    } else if (source.source === "static") {
      out[key] = {
        source: "static",
        value: typeof source.value === "string" ? source.value.trim() : "",
      };
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
