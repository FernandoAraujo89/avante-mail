import twilio from "twilio";
import { describe, expect, it } from "vitest";

import {
  EMPTY_TWIML,
  isSmsOptOutMessage,
  publicWebhookUrl,
  shouldBlockContact,
  smsStatusPatch,
  verifyTwilioSignature,
  type CurrentSmsSendState,
} from "./webhook";

// ─── Assinatura ──────────────────────────────────────────────────────

describe("verifyTwilioSignature", () => {
  const authToken = "token-de-teste";
  const url = "https://exemplo.test/api/webhooks/twilio/status";
  const params = { MessageSid: "SM123", MessageStatus: "delivered" };

  // A assinatura VÁLIDA vem do próprio SDK — o teste confere que validamos
  // exatamente o que a Twilio produz, não uma reimplementação nossa.
  const assinaturaValida = twilio.getExpectedTwilioSignature(
    authToken,
    url,
    params
  );

  it("aceita a assinatura correta", () => {
    expect(
      verifyTwilioSignature({ authToken, signature: assinaturaValida, url, params })
    ).toEqual({ ok: true });
  });

  it("rejeita assinatura adulterada", () => {
    expect(
      verifyTwilioSignature({
        authToken,
        signature: assinaturaValida.slice(0, -2) + "xx",
        url,
        params,
      })
    ).toEqual({ ok: false, configured: true });
  });

  it("rejeita quando os params foram alterados", () => {
    expect(
      verifyTwilioSignature({
        authToken,
        signature: assinaturaValida,
        url,
        params: { ...params, MessageStatus: "failed" },
      })
    ).toEqual({ ok: false, configured: true });
  });

  it("rejeita quando a URL não é a assinada (proxy mal montado)", () => {
    expect(
      verifyTwilioSignature({
        authToken,
        signature: assinaturaValida,
        url: "http://app:3000/api/webhooks/twilio/status",
        params,
      })
    ).toEqual({ ok: false, configured: true });
  });

  it("rejeita sem o header de assinatura", () => {
    expect(
      verifyTwilioSignature({ authToken, signature: null, url, params })
    ).toEqual({ ok: false, configured: true });
  });

  it("fail-closed sem o Auth Token configurado", () => {
    expect(
      verifyTwilioSignature({
        authToken: undefined,
        signature: assinaturaValida,
        url,
        params,
      })
    ).toEqual({ ok: false, configured: false });
  });
});

describe("publicWebhookUrl", () => {
  it("monta a URL da borda a partir do X-Forwarded-*", () => {
    expect(
      publicWebhookUrl({
        forwardedProto: "https",
        forwardedHost: "campanhas.avantetools.com.br",
        host: "app:3000",
        pathname: "/api/webhooks/twilio/status",
        search: "",
      })
    ).toBe("https://campanhas.avantetools.com.br/api/webhooks/twilio/status");
  });

  it("usa o primeiro valor quando o proxy manda lista", () => {
    expect(
      publicWebhookUrl({
        forwardedProto: "https, http",
        forwardedHost: "a.test, b.interno",
        host: null,
        pathname: "/x",
        search: "",
      })
    ).toBe("https://a.test/x");
  });

  it("sem proxy (dev local) cai no host e http", () => {
    expect(
      publicWebhookUrl({
        forwardedProto: null,
        forwardedHost: null,
        host: "localhost:3000",
        pathname: "/api/webhooks/twilio/inbound",
        search: "",
      })
    ).toBe("http://localhost:3000/api/webhooks/twilio/inbound");
  });

  it("preserva a query string — ela entra na assinatura", () => {
    expect(
      publicWebhookUrl({
        forwardedProto: "https",
        forwardedHost: "a.test",
        host: null,
        pathname: "/cb",
        search: "?x=1",
      })
    ).toBe("https://a.test/cb?x=1");
  });
});

// ─── Status callback ─────────────────────────────────────────────────

const pendente: CurrentSmsSendState = {
  status: "pending",
  sentAt: null,
  deliveredAt: null,
};

describe("smsStatusPatch", () => {
  it("queued/sending não mudam nada (ainda é pending)", () => {
    expect(smsStatusPatch(pendente, { status: "queued" })).toBeNull();
    expect(smsStatusPatch(pendente, { status: "sending" })).toBeNull();
  });

  it("sent avança e carimba o sentAt", () => {
    const patch = smsStatusPatch(pendente, { status: "sent" });
    expect(patch?.status).toBe("sent");
    expect(patch?.sentAt).toBeInstanceOf(Date);
  });

  it("delivered preenche o sentAt se o evento sent se perdeu", () => {
    const patch = smsStatusPatch(pendente, { status: "delivered" });
    expect(patch?.status).toBe("delivered");
    expect(patch?.deliveredAt).toBeInstanceOf(Date);
    expect(patch?.sentAt).toBeInstanceOf(Date);
  });

  it("evento atrasado não regride o status (ordem não garantida)", () => {
    const entregue: CurrentSmsSendState = {
      status: "delivered",
      sentAt: new Date(),
      deliveredAt: new Date(),
    };
    expect(smsStatusPatch(entregue, { status: "sent" })).toBeNull();
    expect(smsStatusPatch(entregue, { status: "queued" })).toBeNull();
  });

  it("failed e undelivered viram falha com o ErrorCode", () => {
    for (const status of ["failed", "undelivered"]) {
      const patch = smsStatusPatch(pendente, { status, errorCode: "30003" });
      expect(patch?.status).toBe("failed");
      expect(patch?.errorCode).toBe("30003");
      expect(patch?.errorMessage).toContain("30003");
    }
  });

  it("falha não rebaixa envio já entregue", () => {
    const entregue: CurrentSmsSendState = {
      status: "delivered",
      sentAt: new Date(),
      deliveredAt: new Date(),
    };
    expect(
      smsStatusPatch(entregue, { status: "undelivered", errorCode: "30005" })
    ).toBeNull();
  });

  it("falha registrada é terminal — eventos posteriores são ignorados", () => {
    const falho: CurrentSmsSendState = {
      status: "failed",
      sentAt: null,
      deliveredAt: null,
    };
    expect(smsStatusPatch(falho, { status: "delivered" })).toBeNull();
  });

  it("status desconhecido não mexe em nada", () => {
    expect(smsStatusPatch(pendente, { status: "accepted" })).toBeNull();
    expect(smsStatusPatch(pendente, { status: "canceled" })).toBeNull();
  });

  it("reentrega do mesmo evento é idempotente", () => {
    const enviado: CurrentSmsSendState = {
      status: "sent",
      sentAt: new Date(),
      deliveredAt: null,
    };
    expect(smsStatusPatch(enviado, { status: "sent" })).toBeNull();
  });
});

describe("shouldBlockContact", () => {
  it("bloqueia por 21614 (inválido/fixo) e 21610 (opt-out)", () => {
    expect(shouldBlockContact("21614")).toBe(true);
    expect(shouldBlockContact("21610")).toBe(true);
  });

  it("não bloqueia por falha comum de entrega", () => {
    expect(shouldBlockContact("30003")).toBe(false); // aparelho desligado
    expect(shouldBlockContact(null)).toBe(false);
    expect(shouldBlockContact(undefined)).toBe(false);
  });
});

// ─── Inbound ─────────────────────────────────────────────────────────

describe("isSmsOptOutMessage", () => {
  it("reconhece as palavras da spec", () => {
    for (const palavra of ["PARAR", "SAIR", "CANCELAR", "DESCADASTRAR", "REMOVER"]) {
      expect(isSmsOptOutMessage(palavra)).toBe(true);
    }
  });

  it("tolera caixa, acento e pontuação", () => {
    expect(isSmsOptOutMessage("parar")).toBe(true);
    expect(isSmsOptOutMessage(" Sair. ")).toBe(true);
    expect(isSmsOptOutMessage("CANCELAR!")).toBe(true);
    expect(isSmsOptOutMessage("descadastrár")).toBe(true);
  });

  it("não confunde frase com pedido de opt-out", () => {
    expect(isSmsOptOutMessage("quero parar de receber amanhã")).toBe(false);
    expect(isSmsOptOutMessage("ok")).toBe(false);
    expect(isSmsOptOutMessage("")).toBe(false);
    expect(isSmsOptOutMessage(null)).toBe(false);
    expect(isSmsOptOutMessage(undefined)).toBe(false);
  });
});

describe("EMPTY_TWIML", () => {
  it("é um Response vazio — a confirmação fica no Messaging Service", () => {
    expect(EMPTY_TWIML).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response/>'
    );
  });
});
