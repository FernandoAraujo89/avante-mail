import { describe, expect, it } from "vitest";

import {
  firstBrazilianMobile,
  parseBrazilianMobile,
  toBrazilianMobile,
} from "./phone";

// O alvo destes testes é a bagunça real da base importada de planilha, não o
// caso feliz. Cada formato aqui é um que já apareceu num cadastro de verdade.

describe("parseBrazilianMobile — formatos que a base tem", () => {
  const equivalentes = [
    "+55 37 99947-2264",
    "+5537999472264",
    "(37) 99947-2264",
    "37 99947 2264",
    "37999472264",
    "5537999472264",
    "  37 99947-2264  ",
    "037 99947-2264", // prefixo de tronco
    "0055 37 99947 2264", // discagem internacional
  ];

  for (const entrada of equivalentes) {
    it(`normaliza ${JSON.stringify(entrada)}`, () => {
      expect(toBrazilianMobile(entrada)).toBe("+5537999472264");
    });
  }

  it("acrescenta o nono dígito de cadastro antigo", () => {
    // Antes de 2016 o celular tinha 8 dígitos. A base ainda tem esses.
    expect(toBrazilianMobile("37 9947-2264")).toBe("+5537999472264");
  });

  it("mantém o DDD 55 quando não há código do país", () => {
    // Armadilha: "55" no começo é DDD (São Gabriel/RS), não o código do
    // Brasil. Cortar sem olhar o tamanho destruiria o número.
    expect(toBrazilianMobile("55987654321")).toBe("+5555987654321");
  });
});

describe("parseBrazilianMobile — o que precisa ser recusado", () => {
  it("recusa telefone fixo de 8 dígitos", () => {
    // SMS para fixo é dinheiro perdido: a Twilio devolve 21614.
    expect(parseBrazilianMobile("(37) 3241-0000")).toEqual({
      ok: false,
      motivo: "fixo",
    });
  });

  it("recusa fixo mesmo com código do país", () => {
    expect(parseBrazilianMobile("+553732410000")).toEqual({
      ok: false,
      motivo: "fixo",
    });
  });

  it("recusa DDD que não existe", () => {
    expect(parseBrazilianMobile("(20) 99999-9999")).toEqual({
      ok: false,
      motivo: "ddd",
    });
  });

  it("recusa número de outro país com DDI explícito", () => {
    // +1 689 314-7098 tem a mesma silhueta de um celular de Campinas
    // (19 9…). Sem a checagem de DDI, entraria como brasileiro.
    expect(parseBrazilianMobile("+1 689 314 7098")).toEqual({
      ok: false,
      motivo: "internacional",
    });
  });

  it("recusa quantidade de dígitos impossível", () => {
    expect(parseBrazilianMobile("999").ok).toBe(false);
    expect(parseBrazilianMobile("3799947226419").ok).toBe(false);
  });

  it("recusa vazio, texto e tipos errados", () => {
    expect(parseBrazilianMobile("")).toEqual({ ok: false, motivo: "vazio" });
    expect(parseBrazilianMobile("   ")).toEqual({ ok: false, motivo: "vazio" });
    expect(parseBrazilianMobile("sem telefone")).toEqual({
      ok: false,
      motivo: "vazio",
    });
    expect(parseBrazilianMobile(null).ok).toBe(false);
    expect(parseBrazilianMobile(undefined).ok).toBe(false);
    expect(parseBrazilianMobile(5537999472264).ok).toBe(false);
  });
});

describe("firstBrazilianMobile", () => {
  it("pega o celular quando a célula tem fixo e celular", () => {
    expect(firstBrazilianMobile("37 3241-0000 / 37 99947-2264")).toBe(
      "+5537999472264"
    );
  });

  it("respeita a ordem quando há dois celulares", () => {
    expect(firstBrazilianMobile("91 98121-9276, (91) 98704-2212")).toBe(
      "+5591981219276"
    );
  });

  it("devolve null quando nenhum candidato serve", () => {
    expect(firstBrazilianMobile("3241-0000; 3241-0001")).toBeNull();
  });
});
