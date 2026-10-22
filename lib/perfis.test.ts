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
      "/conversations",
      "/contacts",
      "/contacts/abc/edit",
      "/contacts/import",
      "/lists/abc",
      "/api/pesquisas/abc/perguntas",
      "/api/whatsapp/conversations/abc/messages",
      "/api/whatsapp/unread",
      "/api/whatsapp/media/abc",
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
      // a resposta automática e a configuração do canal são do marketing
      "/api/whatsapp/auto-reply",
      "/api/whatsapp/config",
      "/whatsapp-templates",
      "/contactsx",
    ]) {
      expect(rotaPermitida("expansao", rota, "GET")).toBe(false);
    }
  });

  it("expansão lê os modelos de WhatsApp para o convite, sem editar", () => {
    expect(rotaPermitida("expansao", "/api/whatsapp-templates", "GET")).toBe(true);
    expect(rotaPermitida("expansao", "/api/whatsapp-templates", "POST")).toBe(false);
    expect(rotaPermitida("expansao", "/whatsapp-templates", "GET")).toBe(false);
  });

  it("sucesso do cliente lê o painel das 3 frentes, e só lê", () => {
    for (const rota of ["/pesquisas/parceiros", "/pesquisas/parceiros/abc", "/api/pesquisas/parceiros/abc"]) {
      expect(rotaPermitida("sucesso_cliente", rota, "GET")).toBe(true);
      expect(rotaPermitida("sucesso_cliente", rota, "POST")).toBe(false);
    }
    expect(rotaPermitida("sucesso_cliente", "/pesquisas/abc/relatorio", "GET")).toBe(false);
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
