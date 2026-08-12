import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O SDK inteiro vira mock ANTES do import do client: nenhum teste daqui
// encosta na rede. O que se testa é o CONTRATO com a Twilio — com o que o
// client chama a API, e como classifica cada resposta. (vi.hoisted porque o
// vi.mock é içado para o topo do arquivo, antes das consts.)
const { createMock, twilioMock } = vi.hoisted(() => {
  const createMock = vi.fn();
  const twilioMock = vi.fn(() => ({ messages: { create: createMock } }));
  return { createMock, twilioMock };
});

vi.mock("twilio", () => ({ default: twilioMock }));

import {
  __resetSmsClientForTests,
  isRetryableSmsError,
  sendSms,
  shouldMarkSmsOptOut,
  SmsApiError,
} from "./client";

// Erro no formato do RestException do SDK (status HTTP + código Twilio).
function twilioError(code: number, status: number, message = "erro") {
  return Object.assign(new Error(message), { code, status });
}

const ENV = {
  TWILIO_SMS_ENABLED: "true",
  TWILIO_ACCOUNT_SID: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  TWILIO_API_KEY_SID: "SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  TWILIO_API_KEY_SECRET: "segredo",
  TWILIO_AUTH_TOKEN: "token-webhook",
  TWILIO_SMS_MESSAGING_SERVICE_SID: "MGcccccccccccccccccccccccccccccccc",
  TWILIO_STATUS_CALLBACK_URL: "https://exemplo.test/api/webhooks/twilio/status",
};

beforeEach(() => {
  for (const [chave, valor] of Object.entries(ENV)) vi.stubEnv(chave, valor);
  __resetSmsClientForTests();
  createMock.mockReset();
  twilioMock.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("sendSms — contrato com a API", () => {
  it("autentica com API Key + Secret e accountSid como escopo", async () => {
    createMock.mockResolvedValue({ sid: "SM123" });
    await sendSms({ to: "+5537999472264", body: "oi" });

    expect(twilioMock).toHaveBeenCalledWith(
      ENV.TWILIO_API_KEY_SID,
      ENV.TWILIO_API_KEY_SECRET,
      { accountSid: ENV.TWILIO_ACCOUNT_SID }
    );
  });

  it("envia pelo Messaging Service, com statusCallback e SEM from", async () => {
    createMock.mockResolvedValue({ sid: "SM123" });
    const resultado = await sendSms({ to: "+5537999472264", body: "oi" });

    expect(resultado).toEqual({ sid: "SM123" });
    expect(createMock).toHaveBeenCalledTimes(1);
    const payload = createMock.mock.calls[0][0];
    expect(payload).toEqual({
      to: "+5537999472264",
      body: "oi",
      messagingServiceSid: ENV.TWILIO_SMS_MESSAGING_SERVICE_SID,
      statusCallback: ENV.TWILIO_STATUS_CALLBACK_URL,
    });
    // Explícitos porque são REGRAS, não acaso: from anularia o pool do
    // Messaging Service; validityPeriod já está configurado lá (36000s).
    expect(payload).not.toHaveProperty("from");
    expect(payload).not.toHaveProperty("validityPeriod");
  });

  it("reusa o client entre envios (singleton)", async () => {
    createMock.mockResolvedValue({ sid: "SM1" });
    await sendSms({ to: "+5537999472264", body: "a" });
    await sendSms({ to: "+5537999472264", body: "b" });
    expect(twilioMock).toHaveBeenCalledTimes(1);
  });
});

describe("sendSms — classificação de erros", () => {
  it("21614 (inválido/fixo): permanente e marca o contato", async () => {
    createMock.mockRejectedValue(
      twilioError(21614, 400, "To number is not a valid mobile number")
    );
    const erro = await sendSms({ to: "+5537320000000", body: "oi" }).catch(
      (e) => e
    );

    expect(erro).toBeInstanceOf(SmsApiError);
    expect(erro.code).toBe(21614);
    expect(isRetryableSmsError(erro)).toBe(false);
    expect(shouldMarkSmsOptOut(erro)).toBe(true);
  });

  it("21610 (destinatário em opt-out): permanente e marca o contato", async () => {
    createMock.mockRejectedValue(twilioError(21610, 400, "Unsubscribed"));
    const erro = await sendSms({ to: "+5537999472264", body: "oi" }).catch(
      (e) => e
    );

    expect(erro.code).toBe(21610);
    expect(isRetryableSmsError(erro)).toBe(false);
    expect(shouldMarkSmsOptOut(erro)).toBe(true);
  });

  it("429 (limite de vazão): transitório, sem marcar contato", async () => {
    createMock.mockRejectedValue(
      twilioError(20429, 429, "Too many requests")
    );
    const erro = await sendSms({ to: "+5537999472264", body: "oi" }).catch(
      (e) => e
    );

    expect(erro.httpStatus).toBe(429);
    expect(isRetryableSmsError(erro)).toBe(true);
    expect(shouldMarkSmsOptOut(erro)).toBe(false);
  });

  it("5xx: transitório", async () => {
    createMock.mockRejectedValue(twilioError(20500, 500, "Internal error"));
    const erro = await sendSms({ to: "+5537999472264", body: "oi" }).catch(
      (e) => e
    );
    expect(isRetryableSmsError(erro)).toBe(true);
  });

  it("4xx de conteúdo: permanente, sem marcar contato", async () => {
    createMock.mockRejectedValue(twilioError(21602, 400, "Body is required"));
    const erro = await sendSms({ to: "+5537999472264", body: "" }).catch(
      (e) => e
    );
    expect(isRetryableSmsError(erro)).toBe(false);
    expect(shouldMarkSmsOptOut(erro)).toBe(false);
  });

  it("falha de rede (sem resposta HTTP): transitória", async () => {
    createMock.mockRejectedValue(new Error("socket hang up"));
    const erro = await sendSms({ to: "+5537999472264", body: "oi" }).catch(
      (e) => e
    );
    expect(erro).toBeInstanceOf(SmsApiError);
    expect(erro.httpStatus).toBe(0);
    expect(isRetryableSmsError(erro)).toBe(true);
  });
});
