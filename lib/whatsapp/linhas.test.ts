import { afterEach, describe, expect, it } from "vitest";

import {
  caixaDaLinha,
  caixasDoPerfil,
  caixasPedidas,
  ehLinha,
  linhaConfigurada,
  linhaDaConversaDoEvento,
  linhaDeOutroNumero,
  linhaDoPhoneNumberId,
  linhasDoPerfil,
  linhasPedidas,
  outroNumeroDaLinha,
  phoneNumberIdDaLinha,
} from "./linhas";

const original = { ...process.env };
afterEach(() => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = original.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_EXPANSAO_PHONE_NUMBER_ID = original.WHATSAPP_EXPANSAO_PHONE_NUMBER_ID;
});

describe("linhas", () => {
  it("lê o número de cada linha do ambiente", () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "111";
    delete process.env.WHATSAPP_EXPANSAO_PHONE_NUMBER_ID;
    expect(phoneNumberIdDaLinha("comunicados")).toBe("111");
    expect(phoneNumberIdDaLinha("expansao")).toBeNull();
    expect(linhaConfigurada("comunicados")).toBe(true);
    expect(linhaConfigurada("expansao")).toBe(false);
  });

  it("descobre a linha pelo phone_number_id do webhook", () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "111";
    process.env.WHATSAPP_EXPANSAO_PHONE_NUMBER_ID = "222";
    expect(linhaDoPhoneNumberId("222")).toBe("expansao");
    expect(linhaDoPhoneNumberId("111")).toBe("comunicados");
    expect(linhaDoPhoneNumberId("999")).toBeNull();
    expect(linhaDoPhoneNumberId(undefined)).toBeNull();
  });

  it("cada perfil alcança as suas linhas", () => {
    expect(linhasDoPerfil("admin")).toEqual(["comunicados", "expansao"]);
    expect(linhasDoPerfil("expansao")).toEqual(["expansao"]);
    expect(linhasDoPerfil("sucesso_cliente")).toEqual([]);
    expect(linhasPedidas("admin", "expansao")).toEqual(["expansao"]);
    expect(linhasPedidas("admin", "x")).toEqual(["comunicados", "expansao"]);
    expect(linhasPedidas("expansao", "comunicados")).toEqual(["expansao"]);
    expect(ehLinha("expansao")).toBe(true);
    expect(ehLinha("outra")).toBe(false);
  });

  it("número que não é linha nossa vira conversa própria em outros números", () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "111";
    process.env.WHATSAPP_EXPANSAO_PHONE_NUMBER_ID = "222";
    expect(linhaDaConversaDoEvento("111")).toBe("comunicados");
    expect(linhaDaConversaDoEvento("222")).toBe("expansao");
    expect(linhaDaConversaDoEvento("1382237371")).toBe("outros:1382237371");
    // Sem como saber de quem é o número: o padrão de antes.
    expect(linhaDaConversaDoEvento(undefined)).toBe("comunicados");
    expect(linhaDaConversaDoEvento("PNID_TEST")).toBe("comunicados");
  });

  it("sem a linha de comunicados configurada, nada vira outro número", () => {
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_EXPANSAO_PHONE_NUMBER_ID;
    expect(linhaDaConversaDoEvento("1382237371")).toBe("comunicados");
  });

  it("a linha de outro número guarda o id e cai na caixa outros", () => {
    const linha = linhaDeOutroNumero("987");
    expect(linha).toBe("outros:987");
    expect(outroNumeroDaLinha(linha)).toBe("987");
    expect(outroNumeroDaLinha("comunicados")).toBeNull();
    expect(outroNumeroDaLinha("outros:")).toBeNull();
    expect(caixaDaLinha(linha)).toBe("outros");
    expect(caixaDaLinha("expansao")).toBe("expansao");
    expect(ehLinha(linha)).toBe(false);
  });

  it("só o administrador alcança os outros números", () => {
    expect(caixasDoPerfil("admin")).toEqual(["comunicados", "expansao", "outros"]);
    expect(caixasDoPerfil("expansao")).toEqual(["expansao"]);
    expect(caixasDoPerfil("sucesso_cliente")).toEqual([]);
    expect(caixasPedidas("admin", "outros")).toEqual(["outros"]);
    expect(caixasPedidas("admin", "x")).toEqual(["comunicados", "expansao", "outros"]);
    expect(caixasPedidas("expansao", "outros")).toEqual(["expansao"]);
    // As linhas de sempre (ficha do contato, relatório) não mudam.
    expect(linhasDoPerfil("admin")).toEqual(["comunicados", "expansao"]);
  });
});
