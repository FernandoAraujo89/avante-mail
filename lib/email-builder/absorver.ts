// Absorção de HTML editado à mão de volta para o modelo do bloco de texto.
//
// Editar o código de um BLOCO DE TEXTO não cria override: o bloco engole o que
// foi escrito e continua sendo um bloco comum — texto editável no canvas e
// controles do painel lateral valendo. Dá para absorver porque `html` do bloco
// já é HTML livre; só a moldura precisa de tradução:
//
//   <td align/padding>            → attrs.align / attrs.padding
//     <div font-size/color/align> → attrs.fontSize / attrs.color / attrs.align
//       conteúdo                  → block.html
//
// A moldura é do bloco: propriedade de wrapper que não tem atributo
// correspondente (ex.: background no <td>, letter-spacing no <div>) é
// regenerada — quem precisa de moldura realmente livre usa o HTML próprio da
// ESTRUTURA, que continua sendo override.
//
// Roda só no navegador (DOMParser); o commit da edição inline e o painel de
// código são ambos client-side.

import type { TextBlock } from "./types";

/**
 * Lê uma propriedade do ATRIBUTO style, sem passar pelo CSSOM — o CSSOM
 * normaliza cor para rgb(), e o modelo (e o input de cor do painel) fala hex.
 */
function propriedadeDoStyle(style: string, prop: string): string | null {
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i"));
  return m ? m[1].trim() : null;
}

function alinhamentoValido(v: string | null): v is "left" | "center" | "right" {
  return v === "left" || v === "center" || v === "right";
}

/** Absorve o HTML editado (um `<td>…</td>`, em geral) num bloco de texto. */
export function absorverHtmlEmBlocoDeTexto(
  bloco: TextBlock,
  html: string
): TextBlock {
  const attrs = { ...bloco.attrs };
  let conteudo = html.trim();

  // O parse ganha a mesma tabela que o canvas/compilação põem em volta — um
  // <td> solto fora de tabela é descartado pelo parser.
  const doc = new DOMParser().parseFromString(
    `<table><tbody><tr>${html}</tr></tbody></table>`,
    "text/html"
  );
  const tds = doc.querySelectorAll("td");

  if (tds.length === 1) {
    const td = tds[0];
    const styleTd = td.getAttribute("style") ?? "";
    const alignTd = (
      td.getAttribute("align") ?? propriedadeDoStyle(styleTd, "text-align")
    )?.toLowerCase();
    if (alinhamentoValido(alignTd ?? null)) attrs.align = alignTd as typeof attrs.align;
    const padding = propriedadeDoStyle(styleTd, "padding");
    if (padding) attrs.padding = padding;

    // Um único <div> filho é o wrapper que a compilação gera: desembrulha,
    // traduzindo o estilo dele para os atributos do bloco.
    const filhos = Array.from(td.childNodes).filter(
      (n) => n.nodeType !== Node.TEXT_NODE || Boolean(n.textContent?.trim())
    );
    const div =
      filhos.length === 1 &&
      filhos[0].nodeType === Node.ELEMENT_NODE &&
      (filhos[0] as Element).tagName === "DIV"
        ? (filhos[0] as Element)
        : null;

    if (div) {
      const styleDiv = div.getAttribute("style") ?? "";
      const fonte = propriedadeDoStyle(styleDiv, "font-size");
      const px = fonte?.match(/^(\d+(?:\.\d+)?)px$/);
      if (px) attrs.fontSize = Math.round(parseFloat(px[1]));
      const cor = propriedadeDoStyle(styleDiv, "color");
      // Só hex: rgb()/nomes não servem ao input de cor do painel.
      if (cor && /^#[0-9a-f]{3,8}$/i.test(cor)) attrs.color = cor;
      const alignDiv = propriedadeDoStyle(styleDiv, "text-align")?.toLowerCase();
      if (alinhamentoValido(alignDiv ?? null)) attrs.align = alignDiv as typeof attrs.align;
      conteudo = div.innerHTML.trim();
    } else {
      conteudo = td.innerHTML.trim();
    }
  } else if (tds.length > 1) {
    // Mais de uma célula não cabe num bloco: fica o conteúdo, na ordem.
    conteudo = Array.from(tds)
      .map((t) => t.innerHTML.trim())
      .join("\n");
  }
  // Sem <td> nenhum: era só conteúdo — vale como está.

  const novo: TextBlock = { ...bloco, html: conteudo, attrs };
  delete novo.customHtml;
  return novo;
}
