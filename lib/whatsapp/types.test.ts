import { describe, expect, it } from "vitest";

import {
  isMediaHeader,
  missingHeaderMedia,
  parseHeaderType,
  WHATSAPP_HEADER_TYPES,
  WHATSAPP_MEDIA_HEADERS,
} from "./types";

// O cabeçalho do modelo era decidido com ternário fechado
// (`x === "text" ? "text" : "none"`) em cinco lugares. Quando imagem e PDF
// entraram, qualquer ternário esquecido salvaria o modelo como "sem cabeçalho"
// — sem erro na tela, e o arquivo simplesmente não chegaria ao contato. É a
// mesma armadilha que já trocou o canal de SMS por e-mail (parseCampaignChannel).

describe("parseHeaderType", () => {
  it("aceita todos os tipos declarados em WHATSAPP_HEADER_TYPES", () => {
    for (const tipo of WHATSAPP_HEADER_TYPES) {
      expect(parseHeaderType(tipo)).toBe(tipo);
    }
  });

  it("mantém image e document — os que motivaram a função", () => {
    expect(parseHeaderType("image")).toBe("image");
    expect(parseHeaderType("document")).toBe("document");
  });

  it("cai para none quando o tipo é desconhecido ou ausente", () => {
    expect(parseHeaderType("video")).toBe("none");
    expect(parseHeaderType("")).toBe("none");
    expect(parseHeaderType(undefined)).toBe("none");
    expect(parseHeaderType(null)).toBe("none");
  });

  it("é sensível a caixa — o valor vem do banco, não do teclado", () => {
    expect(parseHeaderType("IMAGE")).toBe("none");
  });

  it("não se deixa enganar por tipo errado vindo do corpo da requisição", () => {
    expect(parseHeaderType(1)).toBe("none");
    expect(parseHeaderType(["image"])).toBe("none");
    expect(parseHeaderType({ headerType: "image" })).toBe("none");
  });
});

describe("isMediaHeader", () => {
  it("separa cabeçalho de arquivo de cabeçalho de texto", () => {
    expect(isMediaHeader("image")).toBe(true);
    expect(isMediaHeader("document")).toBe(true);
    expect(isMediaHeader("text")).toBe(false);
    expect(isMediaHeader("none")).toBe(false);
  });

  it("cobre exatamente os formatos com especificação de mídia", () => {
    // Formato novo em WHATSAPP_MEDIA_HEADERS sem entrada aqui quebra o teste.
    for (const tipo of WHATSAPP_HEADER_TYPES) {
      expect(isMediaHeader(tipo)).toBe(tipo in WHATSAPP_MEDIA_HEADERS);
    }
  });
});

describe("missingHeaderMedia", () => {
  it("acusa cabeçalho de arquivo sem arquivo", () => {
    expect(
      missingHeaderMedia({ headerType: "image", headerMediaUrl: null })
    ).toBe(true);
    expect(
      missingHeaderMedia({ headerType: "document", headerMediaUrl: "   " })
    ).toBe(true);
  });

  it("aprova cabeçalho de arquivo com arquivo", () => {
    expect(
      missingHeaderMedia({
        headerType: "image",
        headerMediaUrl: "/uploads/promo-a1b2c3.png",
      })
    ).toBe(false);
  });

  it("ignora modelos sem cabeçalho de arquivo", () => {
    expect(missingHeaderMedia({ headerType: "text", headerMediaUrl: null })).toBe(
      false
    );
    expect(missingHeaderMedia({ headerType: "none", headerMediaUrl: null })).toBe(
      false
    );
  });
});
