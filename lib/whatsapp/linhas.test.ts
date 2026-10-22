import { afterEach, describe, expect, it } from "vitest";

import {
  ehLinha,
  linhaConfigurada,
  linhaDoPhoneNumberId,
  linhasDoPerfil,
  linhasPedidas,
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
});
