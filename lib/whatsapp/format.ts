// Formatação de texto do WhatsApp: *negrito*, _itálico_, ~riscado~ e ```mono```.
// O aplicativo ESCONDE os marcadores e aplica o estilo — a prévia precisa fazer
// o mesmo, senão o que se vê na tela não é o que o contato recebe.
//
// Devolve uma árvore em vez de HTML: a interpretação fica testável aqui e quem
// desenha (bubble-preview) só escolhe as tags. Vale para o CORPO da mensagem;
// cabeçalho e rodapé de template o WhatsApp entrega sem formatação.

export type WhatsAppTextNode =
  | { type: "text"; value: string }
  | {
      type: "bold" | "italic" | "strike" | "mono";
      children: WhatsAppTextNode[];
    };

const MARKERS: Record<string, "bold" | "italic" | "strike"> = {
  "*": "bold",
  _: "italic",
  "~": "strike",
};

const MONO = "```";

/**
 * Índice do marcador que fecha o trecho aberto em `open`, ou -1 se não houver.
 *
 * Duas regras copiadas do comportamento do aplicativo: espaço colado ao
 * marcador não formata (`2 * 3 * 4` fica literal) e a formatação não atravessa
 * quebra de linha. Um candidato inválido não desiste do trecho — segue
 * procurando, então `*a * b*` fica todo em negrito.
 */
function findClose(text: string, open: number): number {
  const marker = text[open];
  if (/\s/.test(text[open + 1] ?? "")) return -1;

  // Começa em open+2: conteúdo vazio (`**`) não é formatação.
  for (let j = open + 2; j < text.length; j++) {
    if (text[j] === "\n") return -1;
    if (text[j] === marker && !/\s/.test(text[j - 1] ?? "")) return j;
  }
  return -1;
}

/** Interpreta a formatação do WhatsApp em uma árvore de nós. */
export function parseWhatsAppFormatting(text: string): WhatsAppTextNode[] {
  const nodes: WhatsAppTextNode[] = [];
  let plainFrom = 0;
  let i = 0;

  function flushPlain(until: number) {
    if (until > plainFrom) {
      nodes.push({ type: "text", value: text.slice(plainFrom, until) });
    }
  }

  while (i < text.length) {
    // Monoespaçado primeiro: o conteúdo entre ``` não é reinterpretado.
    if (text.startsWith(MONO, i)) {
      const close = text.indexOf(MONO, i + MONO.length);
      if (close > i + MONO.length) {
        flushPlain(i);
        nodes.push({
          type: "mono",
          children: [{ type: "text", value: text.slice(i + MONO.length, close) }],
        });
        i = close + MONO.length;
        plainFrom = i;
        continue;
      }
    }

    const type = MARKERS[text[i]];
    if (type) {
      const close = findClose(text, i);
      if (close > -1) {
        flushPlain(i);
        nodes.push({
          type,
          children: parseWhatsAppFormatting(text.slice(i + 1, close)),
        });
        i = close + 1;
        plainFrom = i;
        continue;
      }
    }

    i++;
  }

  flushPlain(text.length);
  return nodes;
}
