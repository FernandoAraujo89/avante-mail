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

/**
 * Marcadores usados para achar, no HTML já compilado, onde começa e termina
 * o pedaço de um bloco ou linha. São comentários HTML porque `mj-raw` dentro
 * de `mj-column` cai no `<tbody>` FORA do `<tr>` — péssimo para conteúdo, mas
 * é exatamente o que se quer de um delimitador: ele fica ao lado do `<tr>` do
 * bloco, e não dentro dele.
 */
export const MARCA_INICIO = "<!--avante:ini-->";
export const MARCA_FIM = "<!--avante:fim-->";

type Marca = { tipo: "bloco" | "linha"; id: string } | null;

/** Envolve o pedaço nos marcadores quando ele é o alvo do recorte. */
function marcar(codigo: string, ehAlvo: boolean): string {
  if (!ehAlvo) return codigo;
  return `<mj-raw>${MARCA_INICIO}</mj-raw>\n${codigo}\n<mj-raw>${MARCA_FIM}</mj-raw>`;
}

function compileBlock(block: Block, design: EmailDesign): string {
  // O `<tr>` é nosso e o `<td>` é do usuário: sem envelope, o HTML cru entraria
  // no `<tbody>` fora de qualquer linha, e o cliente de e-mail o jogaria para
  // cima da tabela. Com ele, o bloco vira uma linha legítima da coluna.
  if (block.customHtml?.trim()) {
    return `<mj-raw><tr>${block.customHtml}</tr></mj-raw>`;
  }
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

function compileRow(row: Row, design: EmailDesign, marca: Marca): string {
  const corpo = row.customHtml?.trim()
    ? `  <mj-raw>${row.customHtml}</mj-raw>`
    : (() => {
        const background =
          row.attrs.backgroundColor || design.settings.contentBackground;
        const columns = row.columns
          .map((col) => {
            const blocks = col.blocks
              .map(
                (block) =>
                  `      ${marcar(
                    compileBlock(block, design),
                    marca?.tipo === "bloco" && marca.id === block.id
                  )}`
              )
              .join("\n");
            return `    <mj-column width="${col.widthPct}%">\n${blocks}\n    </mj-column>`;
          })
          .join("\n");
        return `  <mj-section background-color="${escAttr(background)}" padding="${escAttr(row.attrs.padding)}">\n${columns}\n  </mj-section>`;
      })();

  return marcar(corpo, marca?.tipo === "linha" && marca.id === row.id);
}

/**
 * Compila o design para MJML.
 *
 * `marca` pede que UM bloco ou UMA linha saia entre marcadores. Compilar o
 * documento inteiro e recortar entre eles devolve exatamente o HTML que aquele
 * pedaço gera de verdade — largura da coluna, fundo da linha e tipografia
 * global entram na conta. Montar um MJML só com o bloco daria outro HTML.
 *
 * A marcação é feita AQUI, percorrendo o modelo, e não procurando o trecho no
 * MJML pronto: dois espaçadores iguais compilam para o mesmo texto, e a busca
 * marcaria o primeiro — que pode não ser o que o usuário clicou.
 */
export function compileDesignToMjml(
  design: EmailDesign,
  marca: Marca = null
): string {
  // HTML do documento inteiro sai como está: `compileEmailContent` reconhece
  // que não é MJML e repassa direto, e as variáveis e o pixel de rastreio
  // continuam sendo aplicados depois, como em qualquer template de código.
  // Ao recortar um pedaço é o design SEM o override de documento que interessa:
  // é dele que sai o HTML gerado que serve de ponto de partida para editar.
  if (design.customHtml?.trim() && !marca) return design.customHtml;

  const { settings } = design;
  const rows = design.rows
    .map((row) => compileRow(row, design, marca))
    .join("\n");

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
