// Ao usar um modelo como ponto de partida de uma campanha, o e-mail passa a
// ser editado direto no Criador (WYSIWYG). Por isso trocamos os tokens de
// CONTEÚDO ({{corpo}}, {{titulo}}...) por texto real e editável — o designer
// escreve tudo à mão. Só os tokens POR-DESTINATÁRIO ({{nome_parceiro}} e
// {{unsubscribe_url}}) permanecem, pois são substituídos no envio.

import type { Block, EmailDesign, Row } from "./types";

/** Tokens de conteúdo → texto/URL padrão editável. */
const CONTENT_TOKEN_DEFAULTS: Record<string, string> = {
  titulo: "Título do e-mail",
  subtitulo: "Subtítulo de apoio que resume a novidade.",
  corpo: "Escreva aqui o conteúdo do seu e-mail. Este texto é totalmente editável.",
  cta_texto: "Saiba mais",
  cta_url: "https://avantejuntos.com.br",
};

// Tokens preservados (substituídos por-destinatário no envio real).
const PRESERVED = new Set(["nome_parceiro", "unsubscribe_url"]);

function materializeString(value: string): string {
  return value.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (match, key: string) => {
      if (PRESERVED.has(key)) return match;
      return CONTENT_TOKEN_DEFAULTS[key] ?? match;
    }
  );
}

function materializeBlock(block: Block): Block {
  switch (block.type) {
    case "text":
      return { ...block, html: materializeString(block.html) };
    case "button":
      return {
        ...block,
        text: materializeString(block.text),
        href: materializeString(block.href),
      };
    case "image":
      return {
        ...block,
        src: materializeString(block.src),
        href: materializeString(block.href),
        alt: materializeString(block.alt),
      };
    default:
      return block;
  }
}

/** Aplica a materialização a uma linha (usado também por módulos). */
export function materializeRow(row: Row): Row {
  return {
    ...row,
    columns: row.columns.map((col) => ({
      ...col,
      blocks: col.blocks.map(materializeBlock),
    })),
  };
}

/**
 * Retorna uma cópia do design com os tokens de conteúdo substituídos por
 * texto real editável. Não muta o original.
 */
export function materializeDesignForEditing(design: EmailDesign): EmailDesign {
  return {
    ...design,
    rows: design.rows.map(materializeRow),
  };
}
