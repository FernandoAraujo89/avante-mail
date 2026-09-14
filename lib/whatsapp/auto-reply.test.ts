import { describe, expect, it } from "vitest";

import {
  AUTO_REPLY_DEFAULTS,
  AUTO_REPLY_INTERVAL_MS,
  autoReplyDecision,
  buildAutoReply,
  formatBrazilianPhone,
  parseAutoReplyInput,
  readAutoReplySettings,
  waMeLink,
  type AutoReplySettings,
} from "./auto-reply";

// Normalizador de mentira: o real (libphonenumber) não é o que está em teste.
const normalize = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 12 ? `+${digits}` : null;
};
const format = (e164: string) => `fmt(${e164})`;

describe("buildAutoReply", () => {
  it("troca {telefone} pelo número no jeito brasileiro e aponta o botão para o wa.me", () => {
    const reply = buildAutoReply(AUTO_REPLY_DEFAULTS, format);
    expect(reply.body).toContain("+55 37 99856-8320");
    expect(reply.body).not.toContain("{telefone}");
    expect(reply.url).toBe("https://wa.me/5537998568320");
    expect(reply.buttonText).toBe("Falar com o Sucesso");
  });

  it("a versão sem botão leva o link no fim do texto", () => {
    const reply = buildAutoReply(AUTO_REPLY_DEFAULTS, format);
    expect(reply.fallbackText.endsWith("\n\nhttps://wa.me/5537998568320")).toBe(true);
  });

  it("o padrão cabe nos limites do WhatsApp", () => {
    expect(AUTO_REPLY_DEFAULTS.buttonText.length).toBeLessThanOrEqual(20);
    expect(buildAutoReply(AUTO_REPLY_DEFAULTS, format).body.length).toBeLessThanOrEqual(1024);
  });
});

describe("formatBrazilianPhone", () => {
  it("celular e fixo com hífen; fora do Brasil fica para o formatador geral", () => {
    expect(formatBrazilianPhone("+5537998568320")).toBe("+55 37 99856-8320");
    expect(formatBrazilianPhone("+553732221234")).toBe("+55 37 3222-1234");
    expect(formatBrazilianPhone("+14155550123")).toBeNull();
  });

  it("número de fora do Brasil usa o formatador recebido", () => {
    const reply = buildAutoReply({ ...AUTO_REPLY_DEFAULTS, phone: "+14155550123" }, format);
    expect(reply.body).toContain("fmt(+14155550123)");
  });
});

describe("waMeLink", () => {
  it("usa só os dígitos", () => {
    expect(waMeLink("+55 37 99856-8320")).toBe("https://wa.me/5537998568320");
  });
});

describe("readAutoReplySettings", () => {
  it("sem nada guardado, vale o padrão (ligada)", () => {
    expect(readAutoReplySettings(null)).toEqual(AUTO_REPLY_DEFAULTS);
    expect(readAutoReplySettings(null).enabled).toBe(true);
  });

  it("o que foi guardado vence; o que faltar vem do padrão", () => {
    const settings = readAutoReplySettings(JSON.stringify({ enabled: false, buttonText: "Atendimento" }));
    expect(settings.enabled).toBe(false);
    expect(settings.buttonText).toBe("Atendimento");
    expect(settings.text).toBe(AUTO_REPLY_DEFAULTS.text);
  });

  it("JSON quebrado não derruba o webhook: cai no padrão", () => {
    expect(readAutoReplySettings("{quebrado")).toEqual(AUTO_REPLY_DEFAULTS);
  });
});

describe("parseAutoReplyInput", () => {
  const valid = {
    enabled: true,
    text: "Não é atendimento. Fale com {telefone}.",
    buttonText: "Falar com o Sucesso",
    phone: "(37) 99856-8320 55",
    afterButtonTaps: false,
  };

  it("aceita e normaliza o telefone", () => {
    const result = parseAutoReplyInput({ ...valid, phone: "+55 37 99856-8320" }, normalize);
    expect(result).toEqual({
      ok: true,
      data: { ...valid, phone: "+5537998568320" },
    });
  });

  it("recusa botão acima de 20 caracteres (limite da Meta)", () => {
    const result = parseAutoReplyInput(
      { ...valid, phone: "+5537998568320", buttonText: "Falar com o Sucesso já" },
      normalize
    );
    expect(result.ok).toBe(false);
  });

  it("recusa texto vazio e telefone inválido", () => {
    expect(parseAutoReplyInput({ ...valid, text: "  " }, normalize).ok).toBe(false);
    expect(parseAutoReplyInput({ ...valid, phone: "123" }, normalize).ok).toBe(false);
  });
});

describe("autoReplyDecision", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  const settings: AutoReplySettings = AUTO_REPLY_DEFAULTS;
  const text = { type: "text", isReaction: false, isButtonReply: false };
  const base = {
    settings,
    message: text,
    isOptOut: false,
    lastTeamReplyAt: null,
    lastAutoReplyAt: null,
    now,
  };
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it("mensagem escrita numa conversa sem aviso recente recebe a resposta", () => {
    expect(autoReplyDecision(base)).toEqual({ send: true });
  });

  it("desligada, não responde", () => {
    expect(autoReplyDecision({ ...base, settings: { ...settings, enabled: false } })).toEqual({
      send: false,
      reason: "disabled",
    });
  });

  it("toque em botão não recebe, a não ser que a configuração peça", () => {
    const button = { type: "button", isReaction: false, isButtonReply: true };
    expect(autoReplyDecision({ ...base, message: button })).toEqual({ send: false, reason: "button" });
    expect(
      autoReplyDecision({
        ...base,
        message: button,
        settings: { ...settings, afterButtonTaps: true },
      })
    ).toEqual({ send: true });
  });

  it("reação, aviso de sistema e SAIR não recebem", () => {
    expect(
      autoReplyDecision({ ...base, message: { type: "reaction", isReaction: true, isButtonReply: false } })
    ).toMatchObject({ reason: "reaction" });
    expect(
      autoReplyDecision({ ...base, message: { type: "system", isReaction: false, isButtonReply: false } })
    ).toMatchObject({ reason: "system" });
    expect(autoReplyDecision({ ...base, isOptOut: true })).toMatchObject({ reason: "opt_out" });
  });

  it("não desmente a equipe que respondeu a conversa nas últimas 24h", () => {
    expect(autoReplyDecision({ ...base, lastTeamReplyAt: hoursAgo(3) })).toEqual({
      send: false,
      reason: "team_active",
    });
    expect(autoReplyDecision({ ...base, lastTeamReplyAt: hoursAgo(25) })).toEqual({ send: true });
  });

  it("uma resposta automática por conversa a cada 24h", () => {
    expect(autoReplyDecision({ ...base, lastAutoReplyAt: hoursAgo(1) })).toMatchObject({
      reason: "recent",
    });
    expect(
      autoReplyDecision({
        ...base,
        lastAutoReplyAt: new Date(now.getTime() - AUTO_REPLY_INTERVAL_MS),
      })
    ).toEqual({ send: true });
  });
});
