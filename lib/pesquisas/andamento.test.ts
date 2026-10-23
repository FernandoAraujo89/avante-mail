import { describe, expect, it } from "vitest";

import { andamento, segmentos } from "./andamento";

describe("andamento", () => {
  it("conta cada situação e a porcentagem de concluídas", () => {
    const a = andamento([
      { status: "pending" },
      { status: "opened" },
      { status: "in_progress" },
      { status: "completed" },
      { status: "completed" },
      { status: "closed" },
    ]);
    expect(a).toEqual({
      convidados: 6,
      pendentes: 1,
      abriram: 1,
      respondendo: 1,
      concluidas: 2,
      encerrados: 1,
      pctConcluidas: 33,
    });
    expect(andamento([]).pctConcluidas).toBe(0);
  });

  it("segmentos na ordem do mais avançado, sem os vazios", () => {
    const s = segmentos(andamento([{ status: "completed" }, { status: "pending" }, { status: "pending" }, { status: "pending" }]));
    expect(s.map((x) => [x.chave, x.valor, Math.round(x.pct)])).toEqual([
      ["concluidas", 1, 25],
      ["pendentes", 3, 75],
    ]);
  });
});
