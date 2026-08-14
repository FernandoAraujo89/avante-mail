import { describe, expect, it } from "vitest";

import { CAMPAIGN_CHANNELS, parseCampaignChannel } from "./schema";

// O que estes testes protegem é um bug que já aconteceu: as rotas de campanha
// decidiam o canal com um ternário fechado (`x === "whatsapp" ? … : "email"`).
// Quando o SMS entrou em CAMPAIGN_CHANNELS, ninguém lembrou dos ternários, e
// uma campanha de SMS era salva como e-mail — sem erro, sem aviso, sem nada
// na tela. Só aparecia no disparo, mandando e-mail para quem esperava SMS.

describe("parseCampaignChannel", () => {
  it("aceita todos os canais declarados em CAMPAIGN_CHANNELS", () => {
    // Percorre a constante em vez de listar os canais à mão: um canal novo
    // que a função não souber tratar quebra este teste na hora.
    for (const canal of CAMPAIGN_CHANNELS) {
      expect(parseCampaignChannel(canal)).toBe(canal);
    }
  });

  it("mantém sms como sms — a regressão que motivou a função", () => {
    expect(parseCampaignChannel("sms")).toBe("sms");
  });

  it("cai para email quando o canal é desconhecido", () => {
    expect(parseCampaignChannel("telegram")).toBe("email");
    expect(parseCampaignChannel("")).toBe("email");
  });

  it("cai para email quando não vem canal nenhum", () => {
    expect(parseCampaignChannel(undefined)).toBe("email");
    expect(parseCampaignChannel(null)).toBe("email");
  });

  it("não se deixa enganar por tipo errado vindo do corpo da requisição", () => {
    expect(parseCampaignChannel(1)).toBe("email");
    expect(parseCampaignChannel(["sms"])).toBe("email");
    expect(parseCampaignChannel({ channel: "sms" })).toBe("email");
  });

  it("é sensível a caixa — canal é valor de banco, não texto digitado", () => {
    expect(parseCampaignChannel("SMS")).toBe("email");
  });
});
