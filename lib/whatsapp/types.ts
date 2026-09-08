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

// O cabeçalho aceita UM componente: texto OU um arquivo. Localização existe na
// Meta, mas o editor não oferece.
export const WHATSAPP_HEADER_TYPES = [
  "none",
  "text",
  "image",
  "document",
  "video",
] as const;
export type WhatsAppHeaderType = (typeof WHATSAPP_HEADER_TYPES)[number];

/** Cabeçalhos que carregam arquivo em vez de texto. */
export type WhatsAppMediaHeaderType = Extract<
  WhatsAppHeaderType,
  "image" | "document" | "video"
>;

/**
 * Lê o tipo de cabeçalho vindo de fora (corpo da requisição, JSON do banco).
 * Existe para não repetir ternário fechado — o mesmo erro que já trocou o
 * canal de campanhas de SMS para e-mail (ver parseCampaignChannel).
 */
export function parseHeaderType(value: unknown): WhatsAppHeaderType {
  return WHATSAPP_HEADER_TYPES.includes(value as WhatsAppHeaderType)
    ? (value as WhatsAppHeaderType)
    : "none";
}

export function isMediaHeader(
  type: WhatsAppHeaderType
): type is WhatsAppMediaHeaderType {
  // Lista explícita de propósito: um formato novo em WHATSAPP_MEDIA_HEADERS
  // esquecido aqui é o que types.test.ts pega.
  return type === "image" || type === "document" || type === "video";
}

export interface WhatsAppMediaHeaderSpec {
  /** Nome do formato na lista de cabeçalhos. */
  label: string;
  maxBytes: number;
  /** Extensões aceitas → content-type. */
  types: Record<string, string>;
  /** Valor do accept do seletor de arquivo. */
  accept: string;
  /** Formato correspondente no template da Meta. */
  metaFormat: "IMAGE" | "DOCUMENT" | "VIDEO";
  /** Rótulo do campo de arquivo no editor. */
  fieldLabel: string;
  /** Texto do botão que abre o seletor de arquivo. */
  uploadLabel: string;
  /** Formatos aceitos, exibidos sob o campo (o limite é somado ao lado). */
  hint: string;
  /** Resumo do cabeçalho na lista de modelos. */
  listLabel: string;
  // As duas mensagens abaixo ficam na especificação, e não em ternário na
  // tela e na rota, porque cada formato novo teria de lembrar dos dois lugares.
  /** Erro de arquivo faltando. */
  missingError: string;
  /** Erro de formato recusado. */
  formatError: string;
}

/**
 * Capa do vídeo: o WhatsApp mostra o PRIMEIRO quadro do arquivo como capa, e
 * a Cloud API não aceita miniatura. Para o contato ver o quadro escolhido, o
 * vídeo é regravado com ele parado por este tempo no início — curto o bastante
 * para não atrapalhar quem dá play, longo o bastante para o gerador de
 * miniatura (que às vezes pega um quadro logo depois do zero) cair nele.
 */
export const VIDEO_COVER_STILL_SECONDS = 0.5;

/**
 * Formatos aceitos pela Meta NO CABEÇALHO DE TEMPLATE — mais estreitos que os
 * da mensagem avulsa: imagem só JPEG/PNG (sem GIF, sem SVG), documento só PDF
 * e vídeo só MP4 (sem 3GPP), com teto de 16MB.
 */
export const WHATSAPP_MEDIA_HEADERS: Record<
  WhatsAppMediaHeaderType,
  WhatsAppMediaHeaderSpec
> = {
  image: {
    label: "Imagem (JPG ou PNG)",
    maxBytes: 5 * 1024 * 1024,
    types: { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" },
    accept: "image/png,image/jpeg",
    metaFormat: "IMAGE",
    fieldLabel: "Imagem do cabeçalho *",
    uploadLabel: "Enviar imagem",
    hint: "JPG ou PNG",
    listLabel: "Imagem no cabeçalho",
    missingError: "Envie a imagem do cabeçalho (ou remova o cabeçalho).",
    formatError: "No cabeçalho de imagem a Meta aceita só JPG ou PNG.",
  },
  document: {
    label: "Documento (PDF)",
    maxBytes: 100 * 1024 * 1024,
    types: { pdf: "application/pdf" },
    accept: "application/pdf",
    metaFormat: "DOCUMENT",
    fieldLabel: "PDF do cabeçalho *",
    uploadLabel: "Enviar PDF",
    hint: "PDF (o nome do arquivo aparece no card da conversa)",
    listLabel: "PDF no cabeçalho",
    missingError: "Envie o PDF do cabeçalho (ou remova o cabeçalho).",
    formatError: "No cabeçalho de documento a Meta aceita só PDF.",
  },
  video: {
    // O codec não dá para conferir aqui (só extensão e tamanho): um MP4 com
    // vídeo fora do H.264 ou áudio fora do AAC sobe normal e só é recusado na
    // análise da Meta — daí o aviso na dica.
    label: "Vídeo (MP4)",
    maxBytes: 16 * 1024 * 1024,
    types: { mp4: "video/mp4" },
    accept: "video/mp4",
    metaFormat: "VIDEO",
    fieldLabel: "Vídeo do cabeçalho *",
    uploadLabel: "Enviar vídeo",
    hint: "MP4 com vídeo H.264 e áudio AAC (outros codecs são recusados na análise da Meta)",
    listLabel: "Vídeo no cabeçalho",
    missingError: "Envie o vídeo do cabeçalho (ou remova o cabeçalho).",
    formatError: "No cabeçalho de vídeo a Meta aceita só MP4.",
  },
};

/**
 * Cabeçalho de mídia sem arquivo: o envio seria recusado pela Meta (falta o
 * parâmetro do cabeçalho). Barrado antes do disparo, com mensagem clara.
 */
export function missingHeaderMedia(template: {
  headerType: WhatsAppHeaderType;
  headerMediaUrl: string | null;
}): boolean {
  return isMediaHeader(template.headerType) && !template.headerMediaUrl?.trim();
}

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
