// Designs dos templates de fábrica no formato do Criador de email.
// Mapeamento fiel dos MJML originais (lib/templates/*.mjml) para blocos.

import { createRow, uid } from "./ops";
import {
  createFooterModuleRow,
  createHeaderModuleRow,
  DEFAULT_SETTINGS,
} from "./presets";
import type {
  Block,
  DesignSettings,
  EmailDesign,
  Row,
  TextBlock,
} from "./types";

// ─── Helpers ─────────────────────────────────────────────────────

function text(html: string, attrs: Partial<TextBlock["attrs"]> = {}): Block {
  return {
    id: uid(),
    type: "text",
    html,
    attrs: {
      fontSize: 14,
      color: "",
      align: "center",
      padding: "0px 0px",
      ...attrs,
    },
  };
}

function image(
  src: string,
  attrs: Partial<{
    alt: string;
    width: number | null;
    align: "left" | "center" | "right";
    borderRadius: number;
    padding: string;
  }> = {}
): Block {
  return {
    id: uid(),
    type: "image",
    src,
    alt: attrs.alt ?? "",
    href: "",
    attrs: {
      width: attrs.width ?? null,
      align: attrs.align ?? "center",
      borderRadius: attrs.borderRadius ?? 0,
      padding: attrs.padding ?? "0px 0px",
    },
  };
}

function ctaButton(
  overrides: Partial<{
    backgroundColor: string;
    color: string;
    align: "left" | "center" | "right";
    padding: string;
  }> = {}
): Block {
  return {
    id: uid(),
    type: "button",
    text: "{{cta_texto}}",
    href: "{{cta_url}}",
    attrs: {
      backgroundColor: overrides.backgroundColor ?? "#1D50DC",
      color: overrides.color ?? "#FFFFFF",
      fontSize: 15,
      borderRadius: 8,
      align: overrides.align ?? "center",
      padding: overrides.padding ?? "28px 0px 0px 0px",
    },
  };
}

function row(
  blocks: Block[],
  attrs: Partial<Row["attrs"]> = {},
  widths: number[] = [100]
): Row {
  const r = createRow(widths);
  r.attrs = { backgroundColor: "", padding: "0px 0px", ...attrs };
  r.columns[0].blocks = blocks;
  return r;
}

/** Faixa divisória cinza (padrão dos e-mails claros da Avante). */
function bandRow(): Row {
  return row(
    [{ id: uid(), type: "spacer", attrs: { height: 10 } }],
    { backgroundColor: "#EFF2F6", padding: "0px 0px" }
  );
}

// ─── 1. Institucional Claro ──────────────────────────────────────

export function institucionalClaroDesign(): EmailDesign {
  const saudacao = row(
    [
      text('<b style="color:#1D50DC;">Olá, {{nome_parceiro}}!</b>', {
        fontSize: 15,
        padding: "0px 0px 14px 0px",
      }),
      text("<b>{{titulo}}</b>", {
        fontSize: 23,
        color: "#14181F",
        padding: "0px 0px 16px 0px",
      }),
      text("{{subtitulo}}", { fontSize: 15 }),
    ],
    { padding: "40px 48px 34px 48px" }
  );

  const corpo = row(
    [
      text("{{corpo}}"),
      ctaButton(),
      text("<b>Equipe Avante 💙</b>", {
        fontSize: 15,
        color: "#14181F",
        padding: "28px 0px 12px 0px",
      }),
    ],
    { padding: "38px 48px 8px 48px" }
  );

  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    rows: [
      createHeaderModuleRow(),
      saudacao,
      bandRow(),
      corpo,
      createFooterModuleRow(),
    ],
  };
}

// ─── 2. Boas-vindas Parceiro ─────────────────────────────────────

export function boasVindasParceiroDesign(): EmailDesign {
  const hero = row([
    image("https://placehold.co/600x460/eef2ff/1d50dc?text=Banner+Hero+(600x460)", {
      alt: "Bem-vindo à Avante!",
    }),
  ]);

  const parabens = row(
    [
      text('<b style="color:#1D50DC;">Parabéns, {{nome_parceiro}}!</b>', {
        fontSize: 20,
        padding: "0px 0px 8px 0px",
      }),
      text("A partir de hoje, você é<br/>oficialmente nosso parceiro.", {
        fontSize: 20,
        color: "#14181F",
      }),
    ],
    { padding: "34px 48px 0px 48px" }
  );

  const titulo = row(
    [
      text("<b>{{titulo}}</b>", {
        fontSize: 23,
        color: "#14181F",
        padding: "0px 0px 16px 0px",
      }),
      text("{{subtitulo}}", { fontSize: 15 }),
    ],
    { padding: "40px 48px 34px 48px" }
  );

  const portfolio = row(
    [
      text(
        '<b>Um portfólio completo <span style="color:#1D50DC;">para você</span></b>',
        { fontSize: 23, color: "#14181F", padding: "0px 0px 16px 0px" }
      ),
      text(
        'Você tem acesso ao portfólio completo de soluções <b style="color:#14181F;">White Label da Avante,</b> com sistemas desenvolvidos para atender às <b style="color:#14181F;">necessidades específicas de cada segmento.</b>'
      ),
      image("https://placehold.co/520x300/1d50dc/ffffff?text=Card+Avante+Web+(520x300)", {
        alt: "Avante Web",
        width: 520,
        borderRadius: 12,
        padding: "26px 0px 0px 0px",
      }),
    ],
    { padding: "34px 40px 34px 40px" }
  );

  const maisRow = row(
    [
      text(
        '<b>E muito mais para o <span style="color:#1D50DC;">seu negócio</span></b>',
        { fontSize: 23, color: "#14181F", padding: "0px 0px 16px 0px" }
      ),
      text(
        'Além dos sistemas, você conta com uma <b style="color:#14181F;">estrutura completa</b> de plataformas e serviços para <b style="color:#14181F;">facilitar a gestão do seu negócio</b> no dia a dia.'
      ),
    ],
    { padding: "34px 48px 0px 48px" }
  );

  const grid = createRow([50, 50]);
  grid.attrs = { backgroundColor: "", padding: "26px 32px 34px 32px" };
  grid.columns[0].blocks = [
    image("https://placehold.co/252x170/1b1b1c/ffffff?text=Avante+Academy", {
      alt: "Avante Academy",
      borderRadius: 12,
      padding: "0px 8px 16px 0px",
    }),
    image("https://placehold.co/252x170/1d50dc/ffffff?text=Materiais+de+Marketing", {
      alt: "Materiais de Marketing",
      borderRadius: 12,
      padding: "0px 8px 0px 0px",
    }),
  ];
  grid.columns[1].blocks = [
    image("https://placehold.co/252x170/1b1b1c/ffffff?text=Inteligencia+Artificial", {
      alt: "Inteligência Artificial",
      borderRadius: 12,
      padding: "0px 0px 16px 8px",
    }),
    image("https://placehold.co/252x170/1d50dc/ffffff?text=Avante+Gestao", {
      alt: "Avante Gestão",
      borderRadius: 12,
      padding: "0px 0px 0px 8px",
    }),
  ];

  const corpo = row(
    [
      text("{{corpo}}"),
      ctaButton(),
      text("<b>Equipe Avante 💙</b>", {
        fontSize: 15,
        color: "#14181F",
        padding: "28px 0px 12px 0px",
      }),
    ],
    { padding: "38px 48px 8px 48px" }
  );

  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    rows: [
      createHeaderModuleRow(),
      hero,
      parabens,
      titulo,
      bandRow(),
      portfolio,
      bandRow(),
      maisRow,
      grid,
      bandRow(),
      corpo,
      createFooterModuleRow(),
    ],
  };
}

// ─── Escuros (padrão Avante Mail dark) ───────────────────────────

const DARK_SETTINGS: DesignSettings = {
  bodyBackground: "#0D0D0D",
  contentBackground: "#0D0D0D",
  fontFamily: "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  textColor: "#D4D4D4",
  linkColor: "#F5A623",
};

function darkHeaderRow(): Row {
  return row(
    [
      text("<b>&#9650; Avante</b>", {
        fontSize: 20,
        color: "#F5A623",
        align: "left",
        padding: "0px 0px",
      }),
      {
        id: uid(),
        type: "divider",
        attrs: {
          borderColor: "#262626",
          borderWidth: 1,
          padding: "20px 0px 0px 0px",
        },
      },
    ],
    { padding: "32px 24px 0px 24px" }
  );
}

function darkFooterRow(): Row {
  return row(
    [
      {
        id: uid(),
        type: "divider",
        attrs: {
          borderColor: "#262626",
          borderWidth: 1,
          padding: "0px 0px 20px 0px",
        },
      },
      text("Avante Soluções Digitais · Formiga, MG", {
        fontSize: 12,
        color: "#737373",
        align: "left",
        padding: "0px 0px 6px 0px",
      }),
      text(
        'Não quer mais receber nossos e-mails? <a href="{{unsubscribe_url}}" style="color:#F5A623;">Descadastre-se aqui</a>.',
        { fontSize: 12, color: "#737373", align: "left" }
      ),
    ],
    { padding: "32px 24px 40px 24px" }
  );
}

// ─── 3. Novidade de produto (dark) ───────────────────────────────

export function novidadeProdutoDesign(): EmailDesign {
  const conteudo = row(
    [
      text("Olá, {{nome_parceiro}}!", {
        fontSize: 15,
        color: "#A3A3A3",
        align: "left",
        padding: "0px 0px 12px 0px",
      }),
      text("<b>{{titulo}}</b>", {
        fontSize: 26,
        color: "#FFFFFF",
        align: "left",
        padding: "0px 0px 10px 0px",
      }),
      text("{{subtitulo}}", {
        fontSize: 16,
        color: "#A3A3A3",
        align: "left",
        padding: "0px 0px 20px 0px",
      }),
      text("{{corpo}}", { align: "left", padding: "0px 0px 28px 0px" }),
      ctaButton({
        backgroundColor: "#F5A623",
        color: "#000000",
        align: "left",
        padding: "0px 0px 12px 0px",
      }),
    ],
    { padding: "28px 24px 8px 24px" }
  );

  return {
    version: 1,
    settings: { ...DARK_SETTINGS },
    rows: [darkHeaderRow(), conteudo, darkFooterRow()],
  };
}

// ─── 4. Comunicado importante (dark) ─────────────────────────────

export function comunicadoImportanteDesign(): EmailDesign {
  const titulo = row(
    [
      text('<b style="letter-spacing:2px;">COMUNICADO</b>', {
        fontSize: 11,
        color: "#F5A623",
        align: "left",
        padding: "0px 0px 12px 0px",
      }),
      text("<b>{{titulo}}</b>", {
        fontSize: 24,
        color: "#FFFFFF",
        align: "left",
        padding: "0px 0px 8px 0px",
      }),
      text("{{subtitulo}}", {
        fontSize: 15,
        color: "#A3A3A3",
        align: "left",
      }),
    ],
    { padding: "20px 24px 8px 24px" }
  );

  const card = row(
    [
      text("Olá, {{nome_parceiro}}!", {
        align: "left",
        padding: "0px 0px 8px 0px",
      }),
      text("{{corpo}}", { align: "left", padding: "0px 0px 20px 0px" }),
      ctaButton({
        backgroundColor: "#F5A623",
        color: "#000000",
        align: "left",
        padding: "0px 0px 0px 0px",
      }),
    ],
    { backgroundColor: "#161616", padding: "24px 24px" }
  );

  const cardWrapper = row(
    [{ id: uid(), type: "spacer", attrs: { height: 8 } }],
    { padding: "0px 0px" }
  );
  void cardWrapper; // espaçamento tratado nos paddings das linhas

  return {
    version: 1,
    settings: { ...DARK_SETTINGS },
    rows: [darkHeaderRow(), titulo, card, darkFooterRow()],
  };
}

export const FACTORY_TEMPLATE_DESIGNS: {
  name: string;
  category: string;
  design: () => EmailDesign;
}[] = [
  {
    name: "Institucional Claro",
    category: "novidade",
    design: institucionalClaroDesign,
  },
  {
    name: "Boas-vindas Parceiro",
    category: "comunicado",
    design: boasVindasParceiroDesign,
  },
  {
    name: "Novidade de produto",
    category: "novidade",
    design: novidadeProdutoDesign,
  },
  {
    name: "Comunicado importante",
    category: "comunicado",
    design: comunicadoImportanteDesign,
  },
];
