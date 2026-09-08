import { afterEach, describe, expect, it } from "vitest";

import { planBatchDelays, whatsappDailyLimit } from "./pacing";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("whatsappDailyLimit", () => {
  const original = process.env.WHATSAPP_DAILY_LIMIT;
  afterEach(() => {
    if (original === undefined) delete process.env.WHATSAPP_DAILY_LIMIT;
    else process.env.WHATSAPP_DAILY_LIMIT = original;
  });

  it("lê o valor da env", () => {
    process.env.WHATSAPP_DAILY_LIMIT = "8000";
    expect(whatsappDailyLimit()).toBe(8000);
  });

  it("vazio, zero ou inválido desliga o limite", () => {
    for (const value of ["", "0", "-5", "abc"]) {
      process.env.WHATSAPP_DAILY_LIMIT = value;
      expect(whatsappDailyLimit()).toBeNull();
    }
    delete process.env.WHATSAPP_DAILY_LIMIT;
    expect(whatsappDailyLimit()).toBeNull();
  });
});

describe("planBatchDelays", () => {
  it("sem limite: todos os envios saem no delay base", () => {
    expect(
      planBatchDelays({
        total: 3,
        dailyLimit: null,
        usedLast24h: 0,
        baseDelayMs: 500,
      })
    ).toEqual([500, 500, 500]);
  });

  it("campanha que cabe na janela de hoje sai inteira agora", () => {
    expect(
      planBatchDelays({
        total: 4,
        dailyLimit: 10,
        usedLast24h: 0,
        baseDelayMs: 0,
      })
    ).toEqual([0, 0, 0, 0]);
  });

  it("excedente é parcelado em lotes de 24h", () => {
    const delays = planBatchDelays({
      total: 7,
      dailyLimit: 3,
      usedLast24h: 0,
      baseDelayMs: 0,
    });
    expect(delays).toEqual([0, 0, 0, DAY_MS, DAY_MS, DAY_MS, 2 * DAY_MS]);
  });

  it("o que já saiu nas últimas 24h reduz o lote de hoje", () => {
    const delays = planBatchDelays({
      total: 4,
      dailyLimit: 3,
      usedLast24h: 2,
      baseDelayMs: 0,
    });
    expect(delays).toEqual([0, DAY_MS, DAY_MS, DAY_MS]);
  });

  it("janela de hoje já cheia empurra tudo para amanhã em diante", () => {
    const delays = planBatchDelays({
      total: 5,
      dailyLimit: 2,
      usedLast24h: 2,
      baseDelayMs: 0,
    });
    expect(delays).toEqual([DAY_MS, DAY_MS, 2 * DAY_MS, 2 * DAY_MS, 3 * DAY_MS]);
  });

  it("uso acima do limite não vira lote negativo", () => {
    const delays = planBatchDelays({
      total: 2,
      dailyLimit: 3,
      usedLast24h: 50,
      baseDelayMs: 0,
    });
    expect(delays).toEqual([DAY_MS, DAY_MS]);
  });

  it("campanha agendada soma o delay do agendamento a todos os lotes", () => {
    const delays = planBatchDelays({
      total: 3,
      dailyLimit: 2,
      usedLast24h: 0,
      baseDelayMs: 60_000,
    });
    expect(delays).toEqual([60_000, 60_000, 60_000 + DAY_MS]);
  });
});
