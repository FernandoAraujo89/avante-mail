import { describe, expect, it } from "vitest";

import { SERVED_UPLOAD_TYPES } from "../uploads";
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

  it("mantém os cabeçalhos de arquivo — os que motivaram a função", () => {
    expect(parseHeaderType("image")).toBe("image");
    expect(parseHeaderType("document")).toBe("document");
    expect(parseHeaderType("video")).toBe("video");
  });

  it("cai para none quando o tipo é desconhecido ou ausente", () => {
    // "location" existe na Meta, mas o editor não oferece.
    expect(parseHeaderType("location")).toBe("none");
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
    expect(isMediaHeader("video")).toBe(true);
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

describe("WHATSAPP_MEDIA_HEADERS", () => {
  it("só aceita extensão que /uploads sabe servir", () => {
    // A Meta baixa o arquivo do cabeçalho por /uploads a cada envio. Extensão
    // fora de SERVED_UPLOAD_TYPES é recusada por sanitizeUploadName: o modelo
    // nem salva, e o que passasse voltaria 404 para a Meta.
    for (const spec of Object.values(WHATSAPP_MEDIA_HEADERS)) {
      for (const [ext, mime] of Object.entries(spec.types)) {
        expect(SERVED_UPLOAD_TYPES[ext]).toBe(mime);
      }
    }
  });
});
