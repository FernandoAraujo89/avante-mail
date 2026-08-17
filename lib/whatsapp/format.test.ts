import { describe, expect, it } from "vitest";

import { parseWhatsAppFormatting, type WhatsAppTextNode } from "./format";

// A prévia mostrava `*Mais agilidade*` com os asteriscos à mostra, enquanto o
// WhatsApp esconde os marcadores e aplica o negrito. Quem escreve o modelo
// decide pela prévia — ela precisa mentir o mínimo possível sobre o que chega
// no aparelho do contato.

/** Achata a árvore em algo legível: "negrito(Oi)texto( tudo bem)". */
function resumo(nodes: WhatsAppTextNode[]): string {
  return nodes
    .map((node) =>
      node.type === "text"
        ? `texto(${node.value})`
        : `${node.type}(${resumo(node.children)})`
    )
    .join("");
}

describe("parseWhatsAppFormatting", () => {
  it("transforma *negrito* em nó, sem os marcadores", () => {
    expect(resumo(parseWhatsAppFormatting("*Mais agilidade no dia a dia*"))).toBe(
      "bold(texto(Mais agilidade no dia a dia))"
    );
  });

  it("formata só o trecho marcado, preservando o resto", () => {
    expect(resumo(parseWhatsAppFormatting("Baixe em *Painel do Parceiro* hoje"))).toBe(
      "texto(Baixe em )bold(texto(Painel do Parceiro))texto( hoje)"
    );
  });

  it("entende itálico, riscado e monoespaçado", () => {
    expect(resumo(parseWhatsAppFormatting("_ok_ ~não~ ```cod```"))).toBe(
      "italic(texto(ok))texto( )strike(texto(não))texto( )mono(texto(cod))"
    );
  });

  it("aceita aninhamento (negrito com itálico dentro)", () => {
    expect(resumo(parseWhatsAppFormatting("*a _b_ c*"))).toBe(
      "bold(texto(a )italic(texto(b))texto( c))"
    );
  });

  it("não formata multiplicação nem asterisco solto", () => {
    // O caso clássico: espaço colado ao marcador não formata no WhatsApp.
    expect(resumo(parseWhatsAppFormatting("2 * 3 * 4"))).toBe("texto(2 * 3 * 4)");
    expect(resumo(parseWhatsAppFormatting("promoção * imperdível"))).toBe(
      "texto(promoção * imperdível)"
    );
  });

  it("não atravessa quebra de linha", () => {
    expect(resumo(parseWhatsAppFormatting("*abre\nfecha*"))).toBe(
      "texto(*abre\nfecha*)"
    );
  });

  it("ignora marcador sem par e conteúdo vazio", () => {
    expect(resumo(parseWhatsAppFormatting("só *abriu"))).toBe("texto(só *abriu)");
    expect(resumo(parseWhatsAppFormatting("**"))).toBe("texto(**)");
    expect(resumo(parseWhatsAppFormatting("``````"))).toBe("texto(``````)");
  });

  it("mantém as quebras de linha do corpo", () => {
    expect(resumo(parseWhatsAppFormatting("*Título*\nlinha 2"))).toBe(
      "bold(texto(Título))texto(\nlinha 2)"
    );
  });

  it("não reinterpreta o conteúdo do monoespaçado", () => {
    expect(resumo(parseWhatsAppFormatting("```a *b* c```"))).toBe(
      "mono(texto(a *b* c))"
    );
  });

  it("devolve lista vazia para texto vazio", () => {
    expect(parseWhatsAppFormatting("")).toEqual([]);
  });

  it("fecha no marcador válido mesmo com candidato inválido no meio", () => {
    expect(resumo(parseWhatsAppFormatting("*a * b*"))).toBe("bold(texto(a * b))");
  });
});
