import { describe, expect, it } from "vitest";

import { paginaInicial, rotaPermitida } from "./perfis";

describe("rotaPermitida", () => {
  it("admin alcança tudo", () => {
    expect(rotaPermitida("admin", "/campaigns", "GET")).toBe(true);
    expect(rotaPermitida("admin", "/api/campaigns/x/send", "POST")).toBe(true);
  });

  it("sucesso do cliente alcança contatos, listas e solicitações", () => {
    for (const rota of [
      "/contacts",
      "/contacts/import",
      "/lists/abc",
      "/solicitacoes",
      "/api/contacts/import",
      "/api/lists/abc/contacts",
      "/api/solicitacoes/abc",
      "/api/auth/me",
    ]) {
      expect(rotaPermitida("sucesso_cliente", rota, "POST")).toBe(true);
    }
  });

  it("sucesso do cliente não dispara campanha nem mexe no resto", () => {
    for (const rota of [
      "/dashboard",
      "/campaigns",
      "/campaigns/new",
      "/api/campaigns",
      "/api/campaigns/abc/send",
      "/automations",
      "/leads",
      "/users",
      "/api/users",
      "/api/whatsapp/unread",
      // prefixo parecido não vale
      "/contactsx",
      "/api/listsecretas",
    ]) {
      expect(rotaPermitida("sucesso_cliente", rota, "GET")).toBe(false);
    }
  });

  it("etapas do funil: só leitura", () => {
    expect(rotaPermitida("sucesso_cliente", "/api/leads/etapas", "GET")).toBe(true);
    expect(rotaPermitida("sucesso_cliente", "/api/leads/etapas", "POST")).toBe(false);
  });

  it("cada perfil tem seu início", () => {
    expect(paginaInicial("admin")).toBe("/dashboard");
    expect(rotaPermitida("sucesso_cliente", paginaInicial("sucesso_cliente"), "GET")).toBe(true);
  });
});
