import { describe, expect, it } from "vitest";

import {
  diffPerguntas,
  parsePerguntas,
  parsePesquisa,
  transicaoDeStatus,
  type PerguntaEntrada,
} from "./perguntas";

const escala = (extra: Partial<PerguntaEntrada> = {}): PerguntaEntrada => ({
  id: null,
  type: "scale",
  label: "Nota",
  help: null,
  required: false,
  options: { min: 0, max: 10 },
  isNps: false,
  ...extra,
});

describe("parsePesquisa", () => {
  it("exige nome e respeita limites", () => {
    expect(parsePesquisa({ name: "  " })).toEqual({ ok: false, error: "Dê um nome à pesquisa." });
    expect(parsePesquisa({ name: "x".repeat(121) }).ok).toBe(false);
    expect(parsePesquisa({ name: " NPS ", intro: " oi ", thanks: "" })).toEqual({
      ok: true,
      dados: { name: "NPS", intro: "oi", thanks: null },
    });
  });
});

describe("parsePerguntas", () => {
  it("normaliza cada tipo", () => {
    const r = parsePerguntas({
      questions: [
        { type: "section", label: "Sobre você", required: true },
        { type: "short_text", label: " Nome ", required: true, help: " dica " },
        { type: "single_choice", label: "Porte", options: { choices: [" A ", "B", ""], other: true } },
        { type: "scale", label: "Nota", options: { min: 1, max: 5, minLabel: "Ruim" } },
        { type: "number", label: "Clientes", options: { unit: " un " } },
        { type: "yes_no", label: "Atendeu?", options: { choices: ["lixo"] } },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.perguntas[0]).toMatchObject({ type: "section", required: false, options: null });
    expect(r.perguntas[1]).toMatchObject({ label: "Nome", help: "dica", required: true });
    expect(r.perguntas[2].options).toEqual({ choices: ["A", "B"], other: true });
    expect(r.perguntas[3].options).toEqual({ min: 1, max: 5, minLabel: "Ruim" });
    expect(r.perguntas[4].options).toEqual({ unit: "un" });
    expect(r.perguntas[5].options).toBeNull();
  });

  it("aponta a pergunta com problema", () => {
    expect(parsePerguntas({ questions: [{ type: "short_text", label: "" }] })).toEqual({
      ok: false,
      error: "Pergunta 1: escreva o enunciado.",
    });
    expect(
      parsePerguntas({
        questions: [
          { type: "short_text", label: "ok" },
          { type: "single_choice", label: "só uma", options: { choices: ["A"] } },
        ],
      })
    ).toEqual({ ok: false, error: "Pergunta 2: uma escolha precisa de pelo menos 2 opções." });
    expect(
      parsePerguntas({ questions: [{ type: "single_choice", label: "rep", options: { choices: ["a", "A"] } }] })
    ).toMatchObject({ ok: false, error: "Pergunta 1: há opções repetidas." });
    expect(
      parsePerguntas({ questions: [{ type: "scale", label: "x", options: { min: 1, max: 1 } }] }).ok
    ).toBe(false);
    expect(parsePerguntas({ questions: [{ type: "banana", label: "x" }] })).toEqual({
      ok: false,
      error: "Pergunta 1: tipo inválido.",
    });
  });

  it("NPS só em escala 0–10 e só uma", () => {
    expect(
      parsePerguntas({ questions: [{ type: "scale", label: "x", isNps: true, options: { min: 1, max: 5 } }] })
    ).toEqual({ ok: false, error: "Pergunta 1: a pergunta do NPS precisa ser uma escala de 0 a 10." });
    expect(
      parsePerguntas({
        questions: [
          { type: "scale", label: "a", isNps: true, options: { min: 0, max: 10 } },
          { type: "scale", label: "b", isNps: true, options: { min: 0, max: 10 } },
        ],
      })
    ).toEqual({ ok: false, error: "Só uma pergunta pode ser a do NPS." });
    const r = parsePerguntas({ questions: [{ type: "scale", label: "a", isNps: true }] });
    expect(r.ok && r.perguntas[0].isNps).toBe(true);
  });
});

describe("diffPerguntas", () => {
  const existentes = [
    { id: "a", type: "scale" as const, temRespostas: true, arquivada: false },
    { id: "b", type: "short_text" as const, temRespostas: false, arquivada: false },
    { id: "velha", type: "short_text" as const, temRespostas: true, arquivada: true },
  ];

  it("cria, atualiza, arquiva e remove conforme as respostas", () => {
    const r = diffPerguntas(existentes, [escala({ id: null }), escala({ id: "a", label: "Nota nova" })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diff.criar.map((c) => c.position)).toEqual([0]);
    expect(r.diff.atualizar).toEqual([expect.objectContaining({ id: "a", position: 1, label: "Nota nova" })]);
    expect(r.diff.arquivar).toEqual([]);
    expect(r.diff.remover).toEqual(["b"]);
  });

  it("pergunta respondida que saiu é arquivada, não removida", () => {
    const r = diffPerguntas(existentes, [escala({ id: "b", type: "short_text" })]);
    expect(r.ok && r.diff.arquivar).toEqual(["a"]);
    expect(r.ok && r.diff.remover).toEqual([]);
  });

  it("não troca o tipo de pergunta respondida nem aceita id estranho", () => {
    expect(diffPerguntas(existentes, [escala({ id: "a", type: "number" })]).ok).toBe(false);
    expect(diffPerguntas(existentes, [escala({ id: "zzz" })])).toEqual({
      ok: false,
      error: "Pergunta 1: não existe mais nesta pesquisa.",
    });
    expect(diffPerguntas(existentes, [escala({ id: "b", type: "short_text" }), escala({ id: "b", type: "short_text" })]).ok).toBe(false);
  });
});

describe("transicaoDeStatus", () => {
  it("segue draft → active → closed → active", () => {
    expect(transicaoDeStatus("draft", "active", 0).ok).toBe(false);
    expect(transicaoDeStatus("draft", "active", 1).ok).toBe(true);
    expect(transicaoDeStatus("active", "closed", 1).ok).toBe(true);
    expect(transicaoDeStatus("closed", "active", 1).ok).toBe(true);
    expect(transicaoDeStatus("active", "draft", 1).ok).toBe(false);
    expect(transicaoDeStatus("draft", "closed", 1).ok).toBe(false);
    expect(transicaoDeStatus("active", "active", 1).ok).toBe(true);
  });
});
