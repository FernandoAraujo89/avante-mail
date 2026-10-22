import { describe, expect, it } from "vitest";

import { paginaInicial, PERFIS, rotaPermitida } from "./perfis";

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
      // as pesquisas são da Expansão (o painel das 3 frentes vem na parte 6)
      "/pesquisas",
      "/api/pesquisas",
      // prefixo parecido não vale
      "/contactsx",
      "/api/listsecretas",
    ]) {
      expect(rotaPermitida("sucesso_cliente", rota, "GET")).toBe(false);
    }
  });

  it("expansão mexe na base de parceiros, como o sucesso do cliente", () => {
    for (const rota of [
      "/pesquisas",
      "/pesquisas/abc/editar",
      "/contacts",
      "/contacts/abc/edit",
      "/contacts/import",
      "/lists/abc",
      "/api/pesquisas/abc/perguntas",
      "/api/contacts/import",
      "/api/lists/abc/contacts",
      "/api/auth/me",
    ]) {
      expect(rotaPermitida("expansao", rota, "POST")).toBe(true);
    }
  });

  it("expansão não pede campanha, não dispara e não vê o resto", () => {
    for (const rota of [
      "/solicitacoes",
      "/api/solicitacoes",
      "/dashboard",
      "/campaigns",
      "/api/campaigns/abc/send",
      "/automations",
      "/users",
      "/api/users",
      "/api/whatsapp/unread",
      "/contactsx",
    ]) {
      expect(rotaPermitida("expansao", rota, "GET")).toBe(false);
    }
  });

  it("nada da área de leads para os perfis restritos", () => {
    for (const perfil of ["sucesso_cliente", "expansao"] as const) {
      expect(rotaPermitida(perfil, "/api/leads/etapas", "GET")).toBe(false);
      expect(rotaPermitida(perfil, "/api/leads", "GET")).toBe(false);
      expect(rotaPermitida(perfil, "/leads", "GET")).toBe(false);
    }
  });

  it("cada perfil tem seu início, e ele é alcançável", () => {
    expect(paginaInicial("admin")).toBe("/dashboard");
    for (const perfil of PERFIS) {
      expect(rotaPermitida(perfil, paginaInicial(perfil), "GET")).toBe(true);
    }
  });
});
