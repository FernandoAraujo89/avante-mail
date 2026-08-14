import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { campaignCost, smsPricePerSegmentUsd } from "./pricing";
import { SMS_BRAZIL_PRICE_PER_SEGMENT_USD } from "./sms/types";

// O cálculo lê env em tempo de chamada; fixar aqui torna o teste independente
// do .env de quem roda. Câmbio redondo (5,00) para o R$ ser conferível de
// cabeça.
beforeEach(() => {
  vi.stubEnv("SES_PRICE_PER_EMAIL_USD", "0.0001");
  vi.stubEnv("USD_BRL_RATE", "5");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("campaignCost — SMS cobra por segmento", () => {
  it("1 segmento por destinatário: preço vezes o número de envios", () => {
    const cost = campaignCost({
      channel: "sms",
      chargeable: 1000,
      smsSegments: 1000,
    });
    expect(cost.usd).toBeCloseTo(1000 * SMS_BRAZIL_PRICE_PER_SEGMENT_USD, 6);
    expect(cost.smsSegments).toBe(1000);
    // `chargeable` continua sendo ENVIOS — quem multiplica a tarifa é o segmento.
    expect(cost.chargeable).toBe(1000);
    expect(cost.unitUsd).toBe(SMS_BRAZIL_PRICE_PER_SEGMENT_USD);
  });

  it("mensagem de 2 segmentos custa o dobro para os mesmos destinatários", () => {
    const curta = campaignCost({
      channel: "sms",
      chargeable: 500,
      smsSegments: 500,
    });
    const longa = campaignCost({
      channel: "sms",
      chargeable: 500,
      smsSegments: 1000,
    });
    expect(longa.usd).toBeCloseTo(curta.usd * 2, 6);
    expect(longa.usd).toBeCloseTo(1000 * SMS_BRAZIL_PRICE_PER_SEGMENT_USD, 6);
    // Mesmo público, conta dobrada: é o susto que o texto de 200 caracteres dá.
    expect(longa.chargeable).toBe(curta.chargeable);
  });

  it("converte para R$ no câmbio configurado", () => {
    const cost = campaignCost({ channel: "sms", chargeable: 10, smsSegments: 20 });
    expect(cost.brl).toBeCloseTo(cost.usd * 5, 6);
  });

  it("sem segmento gravado, cada envio vale 1 — nunca zero", () => {
    // Envio anterior à coluna sms_segments: subestimar é esconder despesa.
    const cost = campaignCost({ channel: "sms", chargeable: 300 });
    expect(cost.smsSegments).toBe(300);
    expect(cost.usd).toBeCloseTo(300 * SMS_BRAZIL_PRICE_PER_SEGMENT_USD, 6);
  });

  it("campanha sem envio não custa nada", () => {
    const cost = campaignCost({ channel: "sms", chargeable: 0, smsSegments: 0 });
    expect(cost.usd).toBe(0);
    expect(cost.brl).toBe(0);
  });

  it("não cobra SMS a preço de e-mail (o bug que este ramo evita)", () => {
    const sms = campaignCost({ channel: "sms", chargeable: 100, smsSegments: 100 });
    const email = campaignCost({ channel: "email", chargeable: 100 });
    expect(sms.usd / email.usd).toBeCloseTo(599, 0);
  });
});

describe("smsPricePerSegmentUsd", () => {
  it("usa a tabela Brasil quando não há env", () => {
    vi.stubEnv("SMS_PRICE_PER_SEGMENT_USD", undefined);
    expect(smsPricePerSegmentUsd()).toBe(SMS_BRAZIL_PRICE_PER_SEGMENT_USD);
  });

  it("aceita tarifa negociada por env", () => {
    vi.stubEnv("SMS_PRICE_PER_SEGMENT_USD", "0.04");
    expect(smsPricePerSegmentUsd()).toBe(0.04);
    expect(
      campaignCost({ channel: "sms", chargeable: 10, smsSegments: 25 }).usd
    ).toBeCloseTo(1, 6);
  });

  it("env vazia ou inválida cai no padrão em vez de zerar a conta", () => {
    vi.stubEnv("SMS_PRICE_PER_SEGMENT_USD", "");
    expect(smsPricePerSegmentUsd()).toBe(SMS_BRAZIL_PRICE_PER_SEGMENT_USD);
    vi.stubEnv("SMS_PRICE_PER_SEGMENT_USD", "de graça");
    expect(smsPricePerSegmentUsd()).toBe(SMS_BRAZIL_PRICE_PER_SEGMENT_USD);
    vi.stubEnv("SMS_PRICE_PER_SEGMENT_USD", "0");
    expect(smsPricePerSegmentUsd()).toBe(SMS_BRAZIL_PRICE_PER_SEGMENT_USD);
  });
});

describe("campaignCost — canais antigos não regrediram", () => {
  it("e-mail continua cobrando por unidade enviada", () => {
    const cost = campaignCost({ channel: "email", chargeable: 1000 });
    expect(cost.usd).toBeCloseTo(0.1, 6);
    expect(cost.brl).toBeCloseTo(0.5, 6);
    expect(cost.unitUsd).toBe(0.0001);
    // Campo do SMS não vaza para os outros canais.
    expect(cost.smsSegments).toBeUndefined();
  });

  it("e-mail ignora segmentos passados por engano", () => {
    const cost = campaignCost({
      channel: "email",
      chargeable: 10,
      smsSegments: 999,
    });
    expect(cost.usd).toBeCloseTo(10 * 0.0001, 6);
  });

  it("WhatsApp continua na tarifa da categoria do modelo", () => {
    expect(
      campaignCost({
        channel: "whatsapp",
        chargeable: 100,
        whatsappCategory: "MARKETING",
      }).usd
    ).toBeCloseTo(100 * 0.0625, 6);
    expect(
      campaignCost({
        channel: "whatsapp",
        chargeable: 100,
        whatsappCategory: "UTILITY",
      }).usd
    ).toBeCloseTo(100 * 0.0068, 6);
  });
});
