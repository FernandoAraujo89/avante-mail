import { describe, expect, it } from "vitest";

import {
  agregar,
  calcularNps,
  formatarValor,
  funil,
  linhasCsv,
  relatorio,
  type ConviteDoRelatorio,
  type PerguntaDoRelatorio,
  type RespostaDoRelatorio,
} from "./relatorio";

const convite = (id: string, status: ConviteDoRelatorio["status"], extra: Partial<ConviteDoRelatorio> = {}): ConviteDoRelatorio => ({
  id,
  status,
  openedAt: null,
  startedAt: null,
  completedAt: null,
  contato: { id: `c-${id}`, name: `Parceiro ${id}`, company: null },
  ...extra,
});

const pergunta = (id: string, type: PerguntaDoRelatorio["type"], extra: Partial<PerguntaDoRelatorio> = {}): PerguntaDoRelatorio => ({
  id,
  type,
  label: id,
  options: null,
  isNps: false,
  arquivada: false,
  position: 0,
  ...extra,
});

const resposta = (inviteId: string, questionId: string, value: RespostaDoRelatorio["value"]): RespostaDoRelatorio => ({
  inviteId,
  questionId,
  value,
  updatedAt: "2026-10-22T10:00:00.000Z",
});

describe("funil", () => {
  it("conta pela situação e pelas datas", () => {
    const f = funil([
      convite("a", "pending"),
      convite("b", "opened"),
      convite("c", "in_progress"),
      convite("d", "completed"),
      convite("e", "closed", { openedAt: "x" }),
    ]);
    expect(f).toEqual({ convidados: 5, abriram: 4, comecaram: 2, concluiram: 1 });
  });
});

describe("calcularNps", () => {
  it("promotores 9–10, detratores 0–6", () => {
    expect(calcularNps([10, 9, 8, 7, 6, 0])).toEqual({ n: 6, promotores: 2, neutros: 2, detratores: 2, score: 0 });
    expect(calcularNps([10, 10, 10, 5])?.score).toBe(50);
    expect(calcularNps([])).toBeNull();
  });
});

describe("agregar", () => {
  const nome = (id: string) => `P${id}`;

  it("escolhas na ordem do modelo, com 'Outro' separado", () => {
    const p = pergunta("q", "multiple_choice", { options: { choices: ["A", "B"], other: true } });
    const a = agregar(p, [resposta("1", "q", ["A", "outro:cafés"]), resposta("2", "q", ["A", "B"]), resposta("3", "q", ["Z"])], nome);
    expect(a).toMatchObject({
      tipo: "barras",
      n: 3,
      itens: [
        { rotulo: "A", count: 2, pct: 67 },
        { rotulo: "B", count: 1, pct: 33 },
        { rotulo: "Outro", count: 1, pct: 33 },
        { rotulo: "Z", count: 1, pct: 33 },
      ],
      outros: [{ texto: "cafés", contato: "P1" }],
    });
  });

  it("escala com distribuição, média e NPS quando é a pergunta-chave", () => {
    const p = pergunta("q", "scale", { options: { min: 0, max: 10 }, isNps: true });
    const a = agregar(p, [resposta("1", "q", 10), resposta("2", "q", 6), resposta("3", "q", 8)], nome);
    expect(a.tipo).toBe("escala");
    if (a.tipo !== "escala") return;
    expect(a.n).toBe(3);
    expect(a.media).toBe(8);
    expect(a.distribuicao).toHaveLength(11);
    expect(a.distribuicao[10]).toEqual({ rotulo: "10", count: 1, pct: 33 });
    expect(a.nps).toEqual({ n: 3, promotores: 1, neutros: 1, detratores: 1, score: 0 });
  });

  it("sim/não, número e texto", () => {
    expect(agregar(pergunta("s", "yes_no"), [resposta("1", "s", true), resposta("2", "s", false), resposta("3", "s", true)], nome)).toEqual({ tipo: "simnao", n: 3, sim: 2, nao: 1 });
    expect(agregar(pergunta("n", "number"), [resposta("1", "n", 10), resposta("2", "n", 20), resposta("3", "n", 60)], nome)).toEqual({ tipo: "numero", n: 3, media: 30, mediana: 20, minimo: 10, maximo: 60 });
    const t = agregar(pergunta("t", "long_text"), [resposta("1", "t", "oi")], nome);
    expect(t).toMatchObject({ tipo: "texto", n: 1, respostas: [{ texto: "oi", contato: "P1" }] });
    expect(agregar(pergunta("x", "section"), [], nome)).toEqual({ tipo: "secao" });
  });
});

describe("relatorio e csv", () => {
  const perguntas = [
    pergunta("nota", "scale", { options: { min: 0, max: 10 }, isNps: true, position: 0, label: "Nota" }),
    pergunta("velha", "short_text", { arquivada: true, position: 0, label: "Velha" }),
    pergunta("ok", "yes_no", { position: 1, label: "Atendeu?" }),
  ];
  const convites = [convite("1", "completed", { completedAt: "2026-10-22T00:00:00.000Z" }), convite("2", "opened")];
  const respostas = [resposta("1", "nota", 9), resposta("1", "ok", true), resposta("1", "velha", "antiga")];

  it("junta funil, NPS e perguntas (ativas antes das arquivadas)", () => {
    const r = relatorio(perguntas, respostas, convites);
    expect(r.nps?.score).toBe(100);
    expect(r.perguntas.map((p) => p.pergunta.id)).toEqual(["nota", "ok", "velha"]);
    expect(r.funil.concluiram).toBe(1);
  });

  it("csv: uma linha por convite, coluna por pergunta, arquivada marcada", () => {
    const { headers, rows } = linhasCsv(perguntas, respostas, convites);
    expect(headers).toEqual(["Parceiro", "Empresa", "Situação", "Concluído em", "Nota", "Atendeu?", "Velha (arquivada)"]);
    expect(rows[0]).toEqual(["Parceiro 1", "", "Concluída", "2026-10-22T00:00:00.000Z", "9", "Sim", "antiga"]);
    expect(rows[1]).toEqual(["Parceiro 2", "", "Abriu", "", "", "", ""]);
  });

  it("formata valores", () => {
    expect(formatarValor(["A", "outro:x"])).toBe("A; Outro: x");
    expect(formatarValor(false)).toBe("Não");
    expect(formatarValor(null)).toBe("");
  });
});
