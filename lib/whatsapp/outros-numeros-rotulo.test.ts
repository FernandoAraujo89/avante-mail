import { describe, expect, it } from "vitest";

import { formatarNumeroDeExibicao, rotuloDoOutroNumero } from "./outros-numeros-rotulo";

describe("rotuloDoOutroNumero", () => {
  it("nome verificado na frente, telefone formatado ao lado", () => {
    expect(
      rotuloDoOutroNumero("1", {
        phoneNumberId: "1",
        displayPhoneNumber: "5537998658302",
        verifiedName: "Sucesso Avante Hub",
      })
    ).toEqual({ nome: "Sucesso Avante Hub", telefone: "+55 37 99865-8302" });
  });

  it("sem nome, o telefone é o nome", () => {
    const rotulo = rotuloDoOutroNumero("1", {
      phoneNumberId: "1",
      displayPhoneNumber: "5537998658302",
      verifiedName: null,
    });
    expect(rotulo.nome).toBe(rotulo.telefone);
  });

  it("sem registro, o id da Meta identifica", () => {
    expect(rotuloDoOutroNumero("123", undefined)).toEqual({
      nome: "Número 123",
      telefone: null,
    });
  });

  it("número brasileiro de empresa, com ou sem o nono dígito, como na Meta", () => {
    expect(formatarNumeroDeExibicao("553788038198")).toBe("+55 37 8803-8198");
    expect(formatarNumeroDeExibicao("553798658302")).toBe("+55 37 9865-8302");
    expect(formatarNumeroDeExibicao("5537998658302")).toBe("+55 37 99865-8302");
    expect(formatarNumeroDeExibicao("15550783881")).toMatch(/^\+1/);
  });
});
