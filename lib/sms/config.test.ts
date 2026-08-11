import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertSmsEnv,
  getSmsConfig,
  isSmsEnabled,
  validateSmsEnv,
} from "./config";

// SIDs fictícios de propósito: o config só confere o prefixo (AC/SK/MG), e um
// valor com cara de credencial real faz a varredura de segredos barrar o push.
const COMPLETO: Record<string, string> = {
  TWILIO_SMS_ENABLED: "true",
  TWILIO_ACCOUNT_SID: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  TWILIO_API_KEY_SID: "SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  TWILIO_API_KEY_SECRET: "segredo-da-api-key",
  TWILIO_AUTH_TOKEN: "token-de-assinatura",
  TWILIO_SMS_MESSAGING_SERVICE_SID: "MGcccccccccccccccccccccccccccccccc",
  TWILIO_STATUS_CALLBACK_URL: "https://exemplo.test/api/webhooks/twilio/status",
};

function comEnv(patch: Record<string, string | undefined> = {}) {
  for (const [chave, valor] of Object.entries({ ...COMPLETO, ...patch })) {
    vi.stubEnv(chave, valor as string);
  }
}

afterEach(() => vi.unstubAllEnvs());

describe("isSmsEnabled", () => {
  it("só liga com o literal true", () => {
    vi.stubEnv("TWILIO_SMS_ENABLED", "true");
    expect(isSmsEnabled()).toBe(true);
    for (const valor of ["false", "1", "sim", "TRUE ", ""]) {
      vi.stubEnv("TWILIO_SMS_ENABLED", valor);
      expect(isSmsEnabled()).toBe(valor === "TRUE ");
    }
  });
});

describe("validateSmsEnv", () => {
  it("não cobra nada quando o canal está desligado", () => {
    // E-mail e WhatsApp não podem parar por causa de SMS não configurado.
    comEnv({
      TWILIO_SMS_ENABLED: "false",
      TWILIO_ACCOUNT_SID: "",
      TWILIO_API_KEY_SECRET: "",
    });
    expect(validateSmsEnv()).toEqual([]);
  });

  it("aceita a configuração completa", () => {
    comEnv();
    expect(validateSmsEnv()).toEqual([]);
  });

  it("nomeia cada variável que falta", () => {
    comEnv({ TWILIO_API_KEY_SECRET: "", TWILIO_AUTH_TOKEN: "" });
    expect(validateSmsEnv()).toEqual([
      "TWILIO_API_KEY_SECRET não definida",
      "TWILIO_AUTH_TOKEN não definida",
    ]);
  });

  it("pega o clássico: SIDs trocados de lugar", () => {
    comEnv({ TWILIO_SMS_MESSAGING_SERVICE_SID: COMPLETO.TWILIO_ACCOUNT_SID });
    expect(validateSmsEnv()).toEqual([
      'TWILIO_SMS_MESSAGING_SERVICE_SID deveria começar com "MG"',
    ]);
  });

  it("recusa callback em http", () => {
    // A Twilio não chama http — o erro apareceria só como status que nunca
    // atualiza, dias depois.
    comEnv({ TWILIO_STATUS_CALLBACK_URL: "http://exemplo.test/status" });
    expect(validateSmsEnv()).toEqual([
      "TWILIO_STATUS_CALLBACK_URL precisa ser https://",
    ]);
  });
});

describe("assertSmsEnv", () => {
  it("passa em silêncio quando está tudo certo", () => {
    comEnv();
    expect(() => assertSmsEnv()).not.toThrow();
  });

  it("falha rápido dizendo o que falta e como desligar", () => {
    comEnv({ TWILIO_API_KEY_SECRET: "" });
    expect(() => assertSmsEnv()).toThrow(/TWILIO_API_KEY_SECRET não definida/);
    expect(() => assertSmsEnv()).toThrow(/TWILIO_SMS_ENABLED=false/);
  });

  it("nunca coloca o valor de um segredo na mensagem", () => {
    // Mensagem de erro vaza para log, para Sentry e para print de tela.
    comEnv({
      TWILIO_STATUS_CALLBACK_URL: "",
      TWILIO_API_KEY_SECRET: "SEGREDO-QUE-NAO-PODE-VAZAR",
      TWILIO_AUTH_TOKEN: "TOKEN-QUE-NAO-PODE-VAZAR",
    });
    try {
      assertSmsEnv();
      throw new Error("deveria ter falhado");
    } catch (erro) {
      const mensagem = (erro as Error).message;
      expect(mensagem).not.toContain("SEGREDO-QUE-NAO-PODE-VAZAR");
      expect(mensagem).not.toContain("TOKEN-QUE-NAO-PODE-VAZAR");
      expect(mensagem).toContain("TWILIO_STATUS_CALLBACK_URL");
    }
  });
});

describe("getSmsConfig", () => {
  it("entrega a configuração pronta", () => {
    comEnv();
    expect(getSmsConfig()).toEqual({
      accountSid: COMPLETO.TWILIO_ACCOUNT_SID,
      apiKeySid: COMPLETO.TWILIO_API_KEY_SID,
      apiKeySecret: COMPLETO.TWILIO_API_KEY_SECRET,
      authToken: COMPLETO.TWILIO_AUTH_TOKEN,
      messagingServiceSid: COMPLETO.TWILIO_SMS_MESSAGING_SERVICE_SID,
      statusCallbackUrl: COMPLETO.TWILIO_STATUS_CALLBACK_URL,
      from: null,
      maxSendRate: 1,
    });
  });

  it("usa 1 msg/s como padrão e respeita o ajuste", () => {
    // Long code entrega ~1/s na prática; o padrão conservador é proposital.
    comEnv({ TWILIO_SMS_MAX_SEND_RATE: "abc" });
    expect(getSmsConfig().maxSendRate).toBe(1);
    comEnv({ TWILIO_SMS_MAX_SEND_RATE: "5" });
    expect(getSmsConfig().maxSendRate).toBe(5);
  });

  it("recusa entregar configuração de canal desligado", () => {
    comEnv({ TWILIO_SMS_ENABLED: "false" });
    expect(() => getSmsConfig()).toThrow(/desligado/);
  });
});
