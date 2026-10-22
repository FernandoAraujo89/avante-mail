import { describe, expect, it } from "vitest";

import { lerLimites, motivoSemLembrete } from "./lembretes";

describe("lerLimites", () => {
  it("usa o padrão quando a configuração falta ou é inválida", () => {
    expect(lerLimites(null, null)).toEqual({ maximo: 3, intervaloHoras: 48 });
    expect(lerLimites("abc", "-1")).toEqual({ maximo: 3, intervaloHoras: 48 });
    expect(lerLimites("5", "24")).toEqual({ maximo: 5, intervaloHoras: 24 });
    expect(lerLimites("0", "0")).toEqual({ maximo: 0, intervaloHoras: 0 });
  });
});

describe("motivoSemLembrete", () => {
  const limites = { maximo: 2, intervaloHoras: 48 };
  const agora = new Date("2026-10-22T12:00:00Z");

  it("concluído e encerrado não recebem", () => {
    expect(motivoSemLembrete({ status: "completed", remindersSent: 0, lastReminderAt: null }, limites, agora)).toBe("concluido");
    expect(motivoSemLembrete({ status: "closed", remindersSent: 0, lastReminderAt: null }, limites, agora)).toBe("concluido");
  });

  it("respeita teto e intervalo", () => {
    expect(motivoSemLembrete({ status: "opened", remindersSent: 2, lastReminderAt: null }, limites, agora)).toBe("limite");
    expect(
      motivoSemLembrete(
        { status: "in_progress", remindersSent: 1, lastReminderAt: "2026-10-21T00:00:00Z" },
        limites,
        agora
      )
    ).toBe("intervalo");
    expect(
      motivoSemLembrete(
        { status: "in_progress", remindersSent: 1, lastReminderAt: "2026-10-19T00:00:00Z" },
        limites,
        agora
      )
    ).toBeNull();
    expect(motivoSemLembrete({ status: "pending", remindersSent: 0, lastReminderAt: null }, limites, agora)).toBeNull();
  });
});
