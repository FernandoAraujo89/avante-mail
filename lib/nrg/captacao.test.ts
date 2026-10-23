import { describe, expect, it } from "vitest";

import { corpoDaCaptacao, enviarLeadAoHub } from "./captacao";

const lead = {
  id: "c1",
  name: "Ana",
  email: "ana@acme.com",
  phone: "+5531999998888",
  company: " ACME ",
  utmSource: "instagram",
  utmMedium: null,
  origem: "Site",
};

describe("captação de leads no NRG Hub", () => {
  it("monta o corpo com o telefone obrigatório e o id daqui como external_id", () => {
    expect(corpoDaCaptacao(lead)).toEqual({
      phone: "+5531999998888",
      external_id: "c1",
      name: "Ana",
      email: "ana@acme.com",
      company: "ACME",
      title: "Lead do Campanhas · Site",
      utm_source: "instagram",
    });
  });

  it("sem telefone não há o que mandar", () => {
    expect(corpoDaCaptacao({ ...lead, phone: null })).toBeNull();
  });

  it("sem a URL da fonte fica quieto; com ela, faz o POST e lê a resposta", async () => {
    expect(await enviarLeadAoHub(lead, { url: undefined })).toEqual({ ok: false, motivo: "sem-url" });
    const chamadas: { url: string; corpo: string }[] = [];
    const buscar = async (url: string, init: RequestInit) => {
      chamadas.push({ url, corpo: String(init.body) });
      return new Response("{}", { status: 200 });
    };
    expect(await enviarLeadAoHub(lead, { url: "https://hub.exemplo/captar/x", buscar })).toEqual({ ok: true, status: 200 });
    expect(chamadas[0].url).toBe("https://hub.exemplo/captar/x");
    expect(JSON.parse(chamadas[0].corpo).external_id).toBe("c1");

    const falha = async () => new Response("erro", { status: 422 });
    expect(await enviarLeadAoHub(lead, { url: "https://hub.exemplo/captar/x", buscar: falha })).toMatchObject({
      ok: false,
      motivo: "falha",
      status: 422,
    });
  });
});
