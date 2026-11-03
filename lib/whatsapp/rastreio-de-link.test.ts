import { describe, expect, it } from "vitest";

import {
  codigoDeTeste,
  codigoDoEnvio,
  destinoDoBotaoRastreado,
  lerCodigo,
  patchDoClique,
} from "./rastreio-de-link";

const SEND = "8bad4032-85a8-4c5d-b20f-4f3a86f4bfaa";
const TEMPLATE = "33608AC6-3807-48EC-B66D-232B72697012";

describe("rastreio do botão de link: o código", () => {
  it("o envio leva o próprio id; o teste leva o id do modelo com prefixo", () => {
    expect(lerCodigo(codigoDoEnvio(SEND))).toEqual({ tipo: "envio", sendId: SEND });
    expect(lerCodigo(codigoDeTeste(TEMPLATE))).toEqual({ tipo: "teste", templateId: TEMPLATE.toLowerCase() });
  });

  it("código que não é id de nada não leva a lugar nenhum", () => {
    expect(lerCodigo("abc123")).toBeNull();
    expect(lerCodigo("t-abc")).toBeNull();
    expect(lerCodigo("")).toBeNull();
  });
});

describe("rastreio do botão de link: o destino", () => {
  it("é a url do botão rastreado, só http(s); sem botão rastreado não há destino", () => {
    expect(
      destinoDoBotaoRastreado([
        { type: "URL", text: "Site", url: "https://x.com" },
        { type: "URL", text: "Ler", url: "https://avante.com/news ", tracked: true },
      ])
    ).toBe("https://avante.com/news");
    expect(destinoDoBotaoRastreado([{ type: "URL", text: "Site", url: "https://x.com" }])).toBeNull();
    expect(destinoDoBotaoRastreado([{ type: "URL", text: "x", url: "javascript:alert(1)", tracked: true }])).toBeNull();
    expect(destinoDoBotaoRastreado(null)).toBeNull();
  });
});

describe("rastreio do botão de link: o que muda no envio", () => {
  const agora = new Date("2026-11-03T12:00:00Z");
  const antes = new Date("2026-11-03T11:00:00Z");

  it("primeiro clique: anota o clique e prova entrega e leitura", () => {
    expect(patchDoClique({ status: "sent", deliveredAt: null, readAt: null, clickedAt: null }, agora)).toEqual({
      clickedAt: agora,
      deliveredAt: agora,
      readAt: agora,
      status: "read",
    });
  });

  it("já entregue e lido: só o clique; clique repetido mantém o primeiro", () => {
    expect(patchDoClique({ status: "read", deliveredAt: antes, readAt: antes, clickedAt: null }, agora)).toEqual({
      clickedAt: agora,
    });
    expect(patchDoClique({ status: "read", deliveredAt: antes, readAt: antes, clickedAt: antes }, agora)).toEqual({
      clickedAt: antes,
    });
  });

  it("entregue sem 'visto': o clique completa a leitura", () => {
    expect(patchDoClique({ status: "delivered", deliveredAt: antes, readAt: null, clickedAt: null }, agora)).toEqual({
      clickedAt: agora,
      readAt: agora,
      status: "read",
    });
  });

  it("falha e devolução são terminais: só o clique fica anotado", () => {
    expect(patchDoClique({ status: "failed", deliveredAt: null, readAt: null, clickedAt: null }, agora)).toEqual({
      clickedAt: agora,
    });
  });
});
