import { describe, expect, it } from "vitest";

import { faltamNaEtapa, minutosEstimados, montarEtapas, primeiraEtapaPendente } from "./etapas";
import type { PerguntaDoFormulario } from "./respostas";

const q = (id: string, type: PerguntaDoFormulario["type"] = "short_text", required = false): PerguntaDoFormulario => ({
  id,
  type,
  label: id,
  help: type === "section" ? "ajuda" : null,
  required,
  options: null,
});

describe("montarEtapas", () => {
  it("com seções, cada seção vira uma etapa e o que vem antes vira 'Para começar'", () => {
    const etapas = montarEtapas([q("a"), q("s1", "section"), q("b"), q("c"), q("s2", "section"), q("d")]);
    expect(etapas.map((e) => [e.titulo, e.perguntas.map((p) => p.id), e.numeroInicial])).toEqual([
      ["Para começar", ["a"], 1],
      ["s1", ["b", "c"], 2],
      ["s2", ["d"], 4],
    ]);
    expect(etapas[1].descricao).toBe("ajuda");
  });

  it("seção vazia some", () => {
    expect(montarEtapas([q("s1", "section"), q("s2", "section"), q("a")]).map((e) => e.titulo)).toEqual(["s2"]);
  });

  it("sem seções, grupos de até seis", () => {
    const perguntas = Array.from({ length: 8 }, (_, i) => q(`p${i}`));
    const etapas = montarEtapas(perguntas);
    expect(etapas.map((e) => [e.titulo, e.perguntas.length, e.numeroInicial])).toEqual([
      ["Parte 1 de 2", 6, 1],
      ["Parte 2 de 2", 2, 7],
    ]);
    expect(montarEtapas([q("a"), q("b")])[0].titulo).toBe("Suas respostas");
    expect(montarEtapas([])).toEqual([]);
  });
});

describe("faltamNaEtapa / primeiraEtapaPendente / minutos", () => {
  it("segura o continuar nas obrigatórias e acha onde a pessoa parou", () => {
    const etapas = montarEtapas([q("a", "short_text", true), q("b"), q("s", "section"), q("c", "short_text", true)]);
    expect(faltamNaEtapa(etapas[0], { b: "x" })).toEqual(["a"]);
    expect(faltamNaEtapa(etapas[0], { a: "x" })).toEqual([]);
    expect(primeiraEtapaPendente(etapas, {})).toBe(0);
    expect(primeiraEtapaPendente(etapas, { a: "x", b: "y" })).toBe(1);
    expect(primeiraEtapaPendente(etapas, { a: "x", b: "y", c: "z" })).toBe(1);
    expect(minutosEstimados(6)).toBe(2);
    expect(minutosEstimados(1)).toBe(1);
  });
});
