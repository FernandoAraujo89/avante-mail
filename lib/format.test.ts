import { describe, expect, it } from "vitest";

import { dayKey, formatDayLabel, formatShortWhen, formatTime } from "./format";

// As conversas agrupam e rotulam pelo dia de BRASÍLIA, qualquer que seja o
// fuso de quem roda o teste ou abre a tela.

describe("dayKey", () => {
  it("usa o dia de Brasília, não o UTC", () => {
    // 01h UTC do dia 15 = 22h do dia 14 em Brasília.
    expect(dayKey("2026-09-15T01:00:00Z")).toBe("2026-09-14");
  });
});

describe("formatTime", () => {
  it("hora e minuto em Brasília", () => {
    expect(formatTime("2026-09-17T12:30:00Z")).toBe("09:30");
  });
});

describe("formatDayLabel", () => {
  const now = new Date("2026-09-15T15:00:00Z"); // 12h em Brasília

  it("hoje e ontem por extenso", () => {
    expect(formatDayLabel("2026-09-15T11:00:00Z", now)).toBe("Hoje");
    expect(formatDayLabel("2026-09-14T11:00:00Z", now)).toBe("Ontem");
  });

  it("a mensagem das 22h de ontem em Brasília é de ontem, mesmo já sendo hoje em UTC", () => {
    expect(formatDayLabel("2026-09-15T01:00:00Z", now)).toBe("Ontem");
  });

  it("antes disso, a data", () => {
    expect(formatDayLabel("2026-09-10T11:00:00Z", now)).toBe("10/09/2026");
  });
});

describe("formatShortWhen", () => {
  const now = new Date("2026-09-15T15:00:00Z");

  it("hoje mostra a hora", () => {
    expect(formatShortWhen("2026-09-15T12:05:00Z", now)).toBe("09:05");
  });

  it("do ano corrente, sem o ano", () => {
    expect(formatShortWhen("2026-08-02T12:00:00Z", now)).toBe("02/08");
  });

  it("de outro ano, com o ano", () => {
    expect(formatShortWhen("2025-12-31T12:00:00Z", now)).toBe("31/12/2025");
  });
});
