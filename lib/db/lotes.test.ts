import { describe, expect, it } from "vitest";

import { emLotes } from "./lotes";

describe("emLotes", () => {
  it("corta na ordem, com o último lote menor", () => {
    expect(emLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("lista que cabe num lote vira um lote só", () => {
    expect(emLotes(["a", "b"], 1000)).toEqual([["a", "b"]]);
  });

  it("lista vazia não gera lote", () => {
    expect(emLotes([], 1000)).toEqual([]);
  });

  it("18 mil itens em lotes de mil: 18 lotes, nada perdido", () => {
    const itens = Array.from({ length: 18_000 }, (_, i) => i);
    const lotes = emLotes(itens, 1000);
    expect(lotes).toHaveLength(18);
    expect(lotes.every((l) => l.length === 1000)).toBe(true);
    expect(lotes.flat()).toEqual(itens);
  });

  it("recusa tamanho que não é inteiro positivo", () => {
    expect(() => emLotes([1], 0)).toThrow(/inválido/);
    expect(() => emLotes([1], 1.5)).toThrow(/inválido/);
  });
});
