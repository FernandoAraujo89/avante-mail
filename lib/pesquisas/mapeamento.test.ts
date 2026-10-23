import { describe, expect, it } from "vitest";

import {
  alertasTratadosNoPrazo,
  detectarAlertas,
  diaDoConvite,
  etapaDoConvite,
  percentualValidado,
  proximoPasso,
  saudeDoParceiro,
  situacaoDoAlerta,
  taxaDeResposta,
} from "./mapeamento";

const dia = (n: number, base = new Date("2026-10-23T12:00:00Z")) => new Date(base.getTime() - n * 86_400_000);
const AGORA = new Date("2026-10-23T12:00:00Z");

describe("etapaDoConvite", () => {
  it("segue Enviado → Abriu → Iniciou → Concluiu → Validado", () => {
    expect(etapaDoConvite({ status: "pending", validatedAt: null }).indice).toBe(0);
    expect(etapaDoConvite({ status: "opened", validatedAt: null }).indice).toBe(1);
    expect(etapaDoConvite({ status: "in_progress", validatedAt: null }).indice).toBe(2);
    expect(etapaDoConvite({ status: "completed", validatedAt: null }).chave).toBe("concluiu");
    expect(etapaDoConvite({ status: "completed", validatedAt: "2026-10-20" }).chave).toBe("validado");
  });

  it("encerrado sem resposta fica fora da régua, com o rótulo do projeto", () => {
    const e = etapaDoConvite({ status: "closed", validatedAt: null, closedReason: "sem_resposta" });
    expect(e.indice).toBe(-1);
    expect(e.rotulo).toBe("Sem resposta");
    expect(etapaDoConvite({ status: "closed", validatedAt: null }).rotulo).toBe("Encerrado");
  });
});

describe("régua de follow-up", () => {
  it("conta D+N em dias inteiros e nunca negativo", () => {
    expect(diaDoConvite(dia(0), AGORA)).toBe(0);
    expect(diaDoConvite(dia(3), AGORA)).toBe(3);
    expect(diaDoConvite(new Date(AGORA.getTime() + 3600_000), AGORA)).toBe(0);
  });

  it("no D+1 o próximo passo é o lembrete, em 2 dias", () => {
    const p = proximoPasso({ status: "pending", createdAt: dia(1), remindersSent: 0, passos: [] }, AGORA);
    expect(p?.passo.chave).toBe("lembrete");
    expect(p?.faltam).toBe(2);
  });

  it("lembrete enviado: no D+8 a mensagem pessoal está 1 dia atrasada", () => {
    const p = proximoPasso({ status: "opened", createdAt: dia(8), remindersSent: 1, passos: [] }, AGORA);
    expect(p?.passo.chave).toBe("mensagem");
    expect(p?.passo.responsavel).toBe("Expansão");
    expect(p?.faltam).toBe(-1);
  });

  it("mensagem e ligação feitas: falta a reunião; resposta assistida fecha a régua", () => {
    const base = { status: "in_progress" as const, createdAt: dia(12), remindersSent: 1 };
    expect(proximoPasso({ ...base, passos: ["mensagem", "ligacao"] }, AGORA)?.passo.chave).toBe("reuniao");
    expect(proximoPasso({ ...base, passos: ["mensagem", "ligacao", "resposta_assistida"] }, AGORA)).toBeNull();
  });

  it("concluído ou encerrado não tem passo", () => {
    expect(proximoPasso({ status: "completed", createdAt: dia(20), remindersSent: 0, passos: [] }, AGORA)).toBeNull();
    expect(proximoPasso({ status: "closed", createdAt: dia(20), remindersSent: 0, passos: [] }, AGORA)).toBeNull();
  });
});

describe("saudeDoParceiro", () => {
  it("NPS 9–10 saudável, 7–8 atenção, 0–6 em risco, sem nota sem medição", () => {
    const base = { riscoAssinalado: false, alertaAberto: false };
    expect(saudeDoParceiro({ ...base, nps: 10 })).toBe("saudavel");
    expect(saudeDoParceiro({ ...base, nps: 8 })).toBe("atencao");
    expect(saudeDoParceiro({ ...base, nps: 6 })).toBe("em_risco");
    expect(saudeDoParceiro({ ...base, nps: null })).toBe("sem_medicao");
  });

  it("risco assinalado ou alerta aberto põe em risco mesmo com NPS alto", () => {
    expect(saudeDoParceiro({ nps: 10, riscoAssinalado: true, alertaAberto: false })).toBe("em_risco");
    expect(saudeDoParceiro({ nps: null, riscoAssinalado: false, alertaAberto: true })).toBe("em_risco");
  });
});

describe("detectarAlertas", () => {
  const nps = { id: "q1", type: "scale" as const, label: "De 0 a 10...", isNps: true, options: { min: 0, max: 10 } };
  const risco = {
    id: "q2",
    type: "single_choice" as const,
    label: "Existe alguma situação de risco?",
    options: { choices: ["Não", "Sim", "Prefiro conversar em reunião"], alertOn: ["Sim", "Prefiro conversar em reunião"] },
  };
  const outra = { id: "q3", type: "multiple_choice" as const, label: "Apoio", options: { choices: ["A", "B"], alertOn: ["B"] } };

  it("NPS até 6 gera alerta de NPS; 7 não", () => {
    expect(detectarAlertas([nps], { q1: 6 })).toEqual([{ reason: "nps", questionId: "q1", detail: "NPS 6" }]);
    expect(detectarAlertas([nps], { q1: 7 })).toEqual([]);
  });

  it("escolha marcada como risco gera um alerta só, com todas as perguntas no detalhe", () => {
    const a = detectarAlertas([risco, outra], { q2: "Sim", q3: ["A", "B"] });
    expect(a).toHaveLength(1);
    expect(a[0].reason).toBe("risco");
    expect(a[0].detail).toBe("Existe alguma situação de risco?: Sim · Apoio: B");
  });

  it("sem resposta, ou escolha fora da lista, não alerta", () => {
    expect(detectarAlertas([risco], {})).toEqual([]);
    expect(detectarAlertas([risco], { q2: "Não" })).toEqual([]);
  });
});

describe("alertas e indicadores", () => {
  const prazo = new Date("2026-10-25T12:00:00Z");
  it("situação do alerta pelo prazo de 48h", () => {
    expect(situacaoDoAlerta({ dueAt: prazo, handledAt: null }, AGORA)).toBe("no_prazo");
    expect(situacaoDoAlerta({ dueAt: prazo, handledAt: null }, new Date("2026-10-26T00:00:00Z"))).toBe("vencido");
    expect(situacaoDoAlerta({ dueAt: prazo, handledAt: "2026-10-24T10:00:00Z" })).toBe("tratado_no_prazo");
    expect(situacaoDoAlerta({ dueAt: prazo, handledAt: "2026-10-27T10:00:00Z" })).toBe("tratado_atrasado");
  });

  it("taxa de resposta, base validada e alertas no prazo em percentual inteiro", () => {
    expect(taxaDeResposta([])).toBeNull();
    expect(
      taxaDeResposta([{ status: "completed" }, { status: "completed" }, { status: "opened" }, { status: "closed" }])
    ).toBe(50);
    expect(
      percentualValidado([
        { status: "completed", validatedAt: "2026-10-22" },
        { status: "completed", validatedAt: null },
        { status: "opened", validatedAt: null },
      ])
    ).toBe(50);
    expect(
      alertasTratadosNoPrazo(
        [
          { dueAt: prazo, handledAt: "2026-10-24T00:00:00Z" },
          { dueAt: prazo, handledAt: null },
        ],
        AGORA
      )
    ).toBe(50);
  });
});
