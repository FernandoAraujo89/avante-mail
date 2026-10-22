import { describe, expect, it } from "vitest";

import { progresso, validarResposta, type PerguntaDoFormulario } from "./respostas";

const q = (
  type: PerguntaDoFormulario["type"],
  options: PerguntaDoFormulario["options"] = null,
  required = false
): PerguntaDoFormulario => ({ id: type, type, label: type, help: null, required, options });

describe("validarResposta", () => {
  it("vazio apaga a resposta, em qualquer tipo", () => {
    expect(validarResposta(q("short_text"), "  ")).toEqual({ ok: true, valor: null });
    expect(validarResposta(q("multiple_choice", { choices: ["A"] }), [])).toEqual({ ok: true, valor: null });
    expect(validarResposta(q("scale", { min: 0, max: 10 }), null)).toEqual({ ok: true, valor: null });
  });

  it("texto, número e escala", () => {
    expect(validarResposta(q("long_text"), " oi ")).toEqual({ ok: true, valor: "oi" });
    expect(validarResposta(q("number"), "12,5")).toEqual({ ok: true, valor: 12.5 });
    expect(validarResposta(q("number"), "abc").ok).toBe(false);
    expect(validarResposta(q("scale", { min: 1, max: 5 }), 5)).toEqual({ ok: true, valor: 5 });
    expect(validarResposta(q("scale", { min: 1, max: 5 }), 0).ok).toBe(false);
    expect(validarResposta(q("scale", { min: 0, max: 10 }), "7")).toEqual({ ok: true, valor: 7 });
  });

  it("sim ou não", () => {
    expect(validarResposta(q("yes_no"), true)).toEqual({ ok: true, valor: true });
    expect(validarResposta(q("yes_no"), "nao")).toEqual({ ok: true, valor: false });
    expect(validarResposta(q("yes_no"), "talvez").ok).toBe(false);
  });

  it("escolhas: só das opções, única é única, outro só quando permitido", () => {
    const unica = q("single_choice", { choices: ["A", "B"] });
    expect(validarResposta(unica, "A")).toEqual({ ok: true, valor: ["A"] });
    expect(validarResposta(unica, ["A", "B"]).ok).toBe(false);
    expect(validarResposta(unica, "C").ok).toBe(false);
    expect(validarResposta(unica, "outro: x").ok).toBe(false);

    const multipla = q("multiple_choice", { choices: ["A", "B"], other: true });
    expect(validarResposta(multipla, ["B", "A", "A", "outro:  Z "])).toEqual({
      ok: true,
      valor: ["B", "A", "outro:Z"],
    });
    expect(validarResposta(multipla, ["outro:   "])).toEqual({ ok: true, valor: null });
  });
});

describe("progresso", () => {
  it("conta só o que pede resposta e aponta as obrigatórias", () => {
    const perguntas = [
      { ...q("section"), id: "s" },
      { ...q("short_text", null, true), id: "a" },
      { ...q("scale", { min: 0, max: 10 }, true), id: "b" },
      { ...q("long_text"), id: "c" },
    ];
    expect(progresso(perguntas, { a: "x", c: "" })).toEqual({
      total: 3,
      respondidas: 1,
      faltamObrigatorias: ["b"],
    });
    expect(progresso(perguntas, { a: "x", b: 0 })).toEqual({
      total: 3,
      respondidas: 2,
      faltamObrigatorias: [],
    });
  });
});
