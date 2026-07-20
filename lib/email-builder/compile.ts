// Compila o documento do Criador de email para MJML.
// O MJML gerado passa pelo mesmo pipeline dos templates de código
// (variáveis Handlebars → mjml2html → pixel de tracking).

import type { Block, EmailDesign, Row } from "./types";

function escAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function compileBlock(block: Block, design: EmailDesign): string {
  switch (block.type) {
    case "text": {
      const color = block.attrs.color || design.settings.textColor;
      return `<mj-text font-size="${block.attrs.fontSize}px" color="${escAttr(color)}" align="${block.attrs.align}" line-height="1.6" padding="${escAttr(block.attrs.padding)}">${block.html}</mj-text>`;
    }
    case "image": {
      const width =
        block.attrs.width && block.attrs.width > 0
          ? ` width="${block.attrs.width}px"`
          : "";
      const href = block.href ? ` href="${escAttr(block.href)}"` : "";
      const radius =
        block.attrs.borderRadius > 0
          ? ` border-radius="${block.attrs.borderRadius}px"`
          : "";
      return `<mj-image src="${escAttr(block.src)}" alt="${escAttr(block.alt)}"${href}${width}${radius} align="${block.attrs.align}" padding="${escAttr(block.attrs.padding)}" fluid-on-mobile="true" />`;
    }
    case "button":
      return `<mj-button href="${escAttr(block.href)}" background-color="${escAttr(block.attrs.backgroundColor)}" color="${escAttr(block.attrs.color)}" font-size="${block.attrs.fontSize}px" font-weight="700" border-radius="${block.attrs.borderRadius}px" inner-padding="12px 32px" align="${block.attrs.align}" padding="${escAttr(block.attrs.padding)}">${block.text}</mj-button>`;
    case "spacer":
      return `<mj-spacer height="${block.attrs.height}px" />`;
    case "divider":
      return `<mj-divider border-color="${escAttr(block.attrs.borderColor)}" border-width="${block.attrs.borderWidth}px" padding="${escAttr(block.attrs.padding)}" />`;
    case "social": {
      const elements = block.items
        .map(
          (item) =>
            `<mj-social-element src="${escAttr(item.iconSrc)}" href="${escAttr(item.href)}" alt="${escAttr(item.label)}" padding="0 6px" />`
        )
        .join("\n        ");
      return `<mj-social mode="horizontal" icon-size="${block.attrs.iconSize}px" border-radius="${Math.round(block.attrs.iconSize / 2)}px" align="${block.attrs.align}" padding="${escAttr(block.attrs.padding)}">\n        ${elements}\n      </mj-social>`;
    }
  }
}

function compileRow(row: Row, design: EmailDesign): string {
  const background = row.attrs.backgroundColor || design.settings.contentBackground;
  const columns = row.columns
    .map((col) => {
      const blocks = col.blocks
        .map((block) => `      ${compileBlock(block, design)}`)
        .join("\n");
      return `    <mj-column width="${col.widthPct}%">\n${blocks}\n    </mj-column>`;
    })
    .join("\n");

  return `  <mj-section background-color="${escAttr(background)}" padding="${escAttr(row.attrs.padding)}">\n${columns}\n  </mj-section>`;
}

export function compileDesignToMjml(design: EmailDesign): string {
  const { settings } = design;
  const rows = design.rows.map((row) => compileRow(row, design)).join("\n");

  return `<mjml>
  <mj-head>
    <mj-title>{{titulo}}</mj-title>
    <mj-preview>{{subtitulo}}</mj-preview>
    <mj-attributes>
      <mj-all font-family="${escAttr(settings.fontFamily)}" />
      <mj-text color="${escAttr(settings.textColor)}" font-size="14px" line-height="1.6" />
    </mj-attributes>
    <mj-style>
      a { color: ${settings.linkColor}; }
    </mj-style>
  </mj-head>
  <mj-body background-color="${escAttr(settings.bodyBackground)}" width="600px">
${rows}
  </mj-body>
</mjml>`;
}

/** Validação mínima de um design vindo da API. */
export function isValidDesign(value: unknown): value is EmailDesign {
  if (!value || typeof value !== "object") return false;
  const design = value as EmailDesign;
  return (
    design.version === 1 &&
    !!design.settings &&
    typeof design.settings.bodyBackground === "string" &&
    Array.isArray(design.rows)
  );
}

/** Validação mínima de uma linha de módulo vinda da API. */
export function isValidRow(value: unknown): value is Row {
  if (!value || typeof value !== "object") return false;
  const row = value as Row;
  return (
    typeof row.id === "string" &&
    Array.isArray(row.columns) &&
    row.columns.every((col) => Array.isArray(col.blocks))
  );
}
