// Presets do Criador de email: estruturas, blocos padrão,
// design inicial e módulos de fábrica da Avante.

import { createRow, uid } from "./ops";
import type {
  Block,
  BlockType,
  DesignSettings,
  EmailDesign,
  Row,
  SocialItem,
} from "./types";

// ─── Estruturas (layouts de colunas) ─────────────────────────────

export const STRUCTURES: { label: string; widths: number[] }[] = [
  { label: "1 coluna", widths: [100] },
  { label: "2 colunas", widths: [50, 50] },
  { label: "3 colunas", widths: [33.33, 33.33, 33.34] },
  { label: "4 colunas", widths: [25, 25, 25, 25] },
  { label: "1/3 + 2/3", widths: [33.33, 66.67] },
  { label: "2/3 + 1/3", widths: [66.67, 33.33] },
];

// ─── Blocos padrão ───────────────────────────────────────────────

export const AVANTE_SOCIAL_ITEMS: SocialItem[] = [
  {
    label: "YouTube",
    iconSrc: "https://files.catbox.moe/pnwz6x.png",
    href: "https://www.youtube.com/@avantesolucoesdigitais",
  },
  {
    label: "LinkedIn",
    iconSrc: "https://files.catbox.moe/dyjwgf.png",
    href: "https://www.linkedin.com/company/26489532/",
  },
  {
    label: "Instagram",
    iconSrc: "https://files.catbox.moe/02mx3s.png",
    href: "https://www.instagram.com/avantesolucoesdigitais/",
  },
];

export function createBlock(type: BlockType): Block {
  switch (type) {
    case "text":
      return {
        id: uid(),
        type: "text",
        html: "Escreva aqui o seu texto. Você pode usar variáveis como {{nome_parceiro}}.",
        attrs: { fontSize: 14, color: "", align: "left", padding: "10px 24px" },
      };
    case "image":
      return {
        id: uid(),
        type: "image",
        src: "https://placehold.co/600x300/eef2ff/1d50dc?text=Imagem",
        alt: "",
        href: "",
        attrs: { width: null, align: "center", borderRadius: 0, padding: "10px 24px" },
      };
    case "button":
      return {
        id: uid(),
        type: "button",
        text: "Clique aqui",
        href: "https://avantejuntos.com.br",
        attrs: {
          backgroundColor: "#1D50DC",
          color: "#FFFFFF",
          fontSize: 15,
          borderRadius: 8,
          align: "center",
          padding: "12px 24px",
        },
      };
    case "spacer":
      return { id: uid(), type: "spacer", attrs: { height: 24 } };
    case "divider":
      return {
        id: uid(),
        type: "divider",
        attrs: { borderColor: "#DDDDDD", borderWidth: 1, padding: "10px 24px" },
      };
    case "social":
      return {
        id: uid(),
        type: "social",
        items: AVANTE_SOCIAL_ITEMS.map((item) => ({ ...item })),
        attrs: { iconSize: 36, align: "center", padding: "12px 24px" },
      };
  }
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  text: "Texto",
  image: "Imagem",
  button: "Botão",
  spacer: "Espaçador",
  divider: "Divisor",
  social: "Social",
};

// ─── Configurações globais padrão (padrão claro Avante/CS) ───────

export const DEFAULT_SETTINGS: DesignSettings = {
  bodyBackground: "#EEF1F5",
  contentBackground: "#FFFFFF",
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  textColor: "#4A5E6E",
  linkColor: "#1D50DC",
};

export const FONT_OPTIONS = [
  {
    label: "Helvetica Neue",
    value: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia (serifada)", value: "Georgia, 'Times New Roman', serif" },
  {
    label: "Inter / sistema",
    value: "Inter, -apple-system, 'Segoe UI', sans-serif",
  },
];

// ─── Módulos de fábrica ──────────────────────────────────────────

export function createHeaderModuleRow(): Row {
  const row = createRow([100]);
  row.attrs.padding = "0px 0px";
  row.columns[0].blocks = [
    {
      id: uid(),
      type: "image",
      src: "https://files.catbox.moe/plyafb.png",
      alt: "Avante",
      href: "",
      attrs: { width: null, align: "center", borderRadius: 0, padding: "0px 0px" },
    },
  ];
  return row;
}

export function createFooterModuleRow(): Row {
  const row = createRow([100]);
  row.attrs.backgroundColor = "#14181C";
  row.attrs.padding = "32px 24px";
  row.columns[0].blocks = [
    {
      id: uid(),
      type: "social",
      items: AVANTE_SOCIAL_ITEMS.map((item) => ({ ...item })),
      attrs: { iconSize: 36, align: "center", padding: "0px 0px 20px 0px" },
    },
    {
      id: uid(),
      type: "text",
      html: "Avante do seu jeito.",
      attrs: {
        fontSize: 14,
        color: "#8A98A5",
        align: "center",
        padding: "0px 0px 20px 0px",
      },
    },
    {
      id: uid(),
      type: "divider",
      attrs: {
        borderColor: "#3A4450",
        borderWidth: 1,
        padding: "0px 40px 16px 40px",
      },
    },
    {
      id: uid(),
      type: "text",
      html: '<a href="https://avantejuntos.com.br" style="color:#FFFFFF;text-decoration:none;font-weight:bold;">avantejuntos.com.br</a>',
      attrs: { fontSize: 12, color: "#FFFFFF", align: "center", padding: "0px 0px 12px 0px" },
    },
    {
      id: uid(),
      type: "text",
      html: 'Não quer mais receber nossos e-mails? <a href="{{unsubscribe_url}}" style="color:#8A98A5;text-decoration:underline;">Descadastre-se aqui</a>.',
      attrs: { fontSize: 12, color: "#8A98A5", align: "center", padding: "0px 0px" },
    },
  ];
  return row;
}

// ─── Design inicial de um template novo ──────────────────────────

export function createDefaultDesign(): EmailDesign {
  const header = createHeaderModuleRow();

  const title = createRow([100]);
  title.attrs.padding = "24px 24px 0px 24px";
  title.columns[0].blocks = [
    {
      id: uid(),
      type: "text",
      html: '<span style="color:#1D50DC;font-weight:bold;">Olá, {{nome_parceiro}}!</span>',
      attrs: { fontSize: 15, color: "", align: "center", padding: "0px 0px 10px 0px" },
    },
    {
      id: uid(),
      type: "text",
      html: '<span style="font-weight:bold;color:#14181F;">Título do e-mail</span>',
      attrs: { fontSize: 23, color: "#14181F", align: "center", padding: "0px 0px 8px 0px" },
    },
    {
      id: uid(),
      type: "text",
      html: "Subtítulo de apoio que resume a novidade.",
      attrs: { fontSize: 15, color: "", align: "center", padding: "0px 0px" },
    },
  ];

  const body = createRow([100]);
  body.attrs.padding = "16px 24px 8px 24px";
  body.columns[0].blocks = [
    {
      id: uid(),
      type: "text",
      html: "Escreva aqui o conteúdo do seu e-mail. Este texto é totalmente editável.",
      attrs: { fontSize: 14, color: "", align: "center", padding: "0px 0px 12px 0px" },
    },
    {
      id: uid(),
      type: "button",
      text: "Saiba mais",
      href: "https://avantejuntos.com.br",
      attrs: {
        backgroundColor: "#1D50DC",
        color: "#FFFFFF",
        fontSize: 15,
        borderRadius: 8,
        align: "center",
        padding: "8px 24px 24px 24px",
      },
    },
  ];

  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    rows: [header, title, body, createFooterModuleRow()],
  };
}
