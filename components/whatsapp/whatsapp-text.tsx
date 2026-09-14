import type { ReactNode } from "react";

import {
  parseWhatsAppFormatting,
  type WhatsAppTextNode,
} from "@/lib/whatsapp/format";

// Texto no jeito do WhatsApp: os marcadores (*negrito*, _itálico_…) viram
// estilo e somem, e todo endereço http(s) vira link — como no aplicativo.

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;
// Pontuação colada no fim ("veja https://x.com.") não faz parte do endereço.
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

function Linkified({ value, links }: { value: string; links: boolean }) {
  if (!links) return <>{value}</>;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of value.matchAll(URL_REGEX)) {
    const start = match.index ?? 0;
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    if (start > last) parts.push(value.slice(last, start));
    parts.push(
      <a
        key={start}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-[#027eb5] underline underline-offset-2"
      >
        {url}
      </a>
    );
    last = start + url.length;
  }
  if (last < value.length) parts.push(value.slice(last));
  return <>{parts}</>;
}

function Nodes({ nodes, links }: { nodes: WhatsAppTextNode[]; links: boolean }) {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === "text") {
          return <Linkified key={index} value={node.value} links={links} />;
        }
        const children = <Nodes nodes={node.children} links={links} />;
        if (node.type === "bold") {
          return (
            <strong key={index} className="font-semibold">
              {children}
            </strong>
          );
        }
        if (node.type === "italic") return <em key={index}>{children}</em>;
        if (node.type === "strike") return <s key={index}>{children}</s>;
        return (
          <code key={index} className="font-mono text-[0.9em]">
            {children}
          </code>
        );
      })}
    </>
  );
}

export function WhatsAppText({
  text,
  links = true,
}: {
  text: string;
  /** Desligado onde o texto já está dentro de um link ou botão. */
  links?: boolean;
}) {
  return <Nodes nodes={parseWhatsAppFormatting(text)} links={links} />;
}
