import { describe, expect, it } from "vitest";

import type { LeadScoreRule } from "@/lib/db";

import {
  eventosQueContam,
  montarConta,
  type Configuracao,
  type EstadoDoContato,
  type EventoPontuavel,
} from "./score";

// O que estes testes protegem: etapa e qualificação são ESTADO. A conta tem
// que dar o mesmo número para a mesma posição no funil, seja qual for o
// caminho até ela — andando etapa por etapa, arrastado direto pelo vendedor
// ou visto chegando pela sincronização.

const AGORA = new Date("2026-09-14T12:00:00Z");
const CONFIG: Configuracao = {
  meiaVidaDias: 30,
  faixaMorno: 20,
  faixaAquecido: 50,
  faixaQuente: 100,
};

let seq = 0;
function regra(
  eventType: LeadScoreRule["eventType"],
  points: number,
  condition: Record<string, unknown> | null = null
): LeadScoreRule {
  seq++;
  return {
    id: `regra-${String(seq).padStart(3, "0")}`,
    eventType,
    condition,
    points,
    active: true,
    description: `${eventType} ${JSON.stringify(condition)}`,
    updatedAt: AGORA,
  };
}

const REGRAS: LeadScoreRule[] = [
  regra("contact_created", 10),
  regra("site_visited", 3),
  regra("lead_stage_changed", 10, { para: "qualificar-lead" }),
  regra("lead_stage_changed", 20, { para: "agendar-apresentacao-parte-tecnica" }),
  regra("lead_stage_changed", 50, { para: "apresentar-proposta-comercial" }),
  regra("lead_stage_changed", 70, { para: "analisando-proposta" }),
  regra("lead_qualified", 60, { qualificacao: "experiente" }),
  regra("lead_qualified", 20, { qualificacao: "intermediario" }),
];

function evento(
  type: EventoPontuavel["type"],
  quando: string,
  payload: Record<string, unknown> | null = null
): EventoPontuavel {
  return { type, payload, createdAt: new Date(quando) };
}

function estado(parcial: Partial<EstadoDoContato> = {}): EstadoDoContato {
  return {
    stage: null,
    stageChangedAt: null,
    qualification: null,
    qualifiedAt: null,
    desde: new Date("2026-09-14T08:00:00Z"),
    ...parcial,
  };
}

function conta(eventos: EventoPontuavel[], est: EstadoDoContato) {
  return montarConta(eventosQueContam(eventos, est), REGRAS, CONFIG, AGORA);
}

const HOJE = "2026-09-14T12:00:00Z";

describe("etapa do funil vale só a atual", () => {
  it("quem andou etapa por etapa vale o mesmo que quem pulou direto", () => {
    const andando = [
      evento("lead_stage_changed", "2026-09-14T09:00:00Z", { para: "qualificar-lead" }),
      evento("lead_stage_changed", "2026-09-14T10:00:00Z", {
        para: "agendar-apresentacao-parte-tecnica",
      }),
      evento("lead_stage_changed", HOJE, { para: "apresentar-proposta-comercial" }),
    ];
    const pulando = [
      evento("lead_stage_changed", HOJE, { para: "apresentar-proposta-comercial" }),
    ];
    const naProposta = estado({ stage: "apresentar-proposta-comercial" });

    expect(conta(andando, naProposta).score).toBe(50);
    expect(conta(pulando, naProposta).score).toBe(50);
  });

  it("voltar de etapa derruba os pontos para os da etapa de agora", () => {
    const eventos = [
      evento("lead_stage_changed", "2026-09-14T09:00:00Z", { para: "analisando-proposta" }),
      evento("lead_stage_changed", HOJE, {
        para: "agendar-apresentacao-parte-tecnica",
      }),
    ];
    const resultado = conta(
      eventos,
      estado({ stage: "agendar-apresentacao-parte-tecnica" })
    );
    expect(resultado.score).toBe(20);
    expect(resultado.linhas).toHaveLength(1);
  });

  it("a conversão em parceiro não apaga a etapa onde ele chegou", () => {
    const eventos = [
      evento("lead_stage_changed", HOJE, { para: "analisando-proposta" }),
      evento("lead_stage_changed", HOJE, { para: null, acao: "convertido em parceiro" }),
    ];
    expect(conta(eventos, estado({ stage: null })).score).toBe(70);
  });

  it("lead criado pelo webhook já numa etapa pontua sem ter 'andado'", () => {
    const resultado = conta(
      [],
      estado({
        stage: "analisando-proposta",
        stageChangedAt: new Date(HOJE),
      })
    );
    expect(resultado.score).toBe(70);
  });

  it("quem nunca saiu da etapa de entrada não ganha ponto de etapa", () => {
    const curinga = [...REGRAS, regra("lead_stage_changed", 5)];
    const resultado = montarConta(
      eventosQueContam([], estado({ stage: "qualificado" })),
      curinga,
      CONFIG,
      AGORA
    );
    expect(resultado.score).toBe(0);
  });

  it("o decaimento conta a partir da chegada na etapa atual", () => {
    const eventos = [
      evento("lead_stage_changed", "2026-08-15T12:00:00Z", { para: "analisando-proposta" }),
    ];
    // 30 dias parado em "Analisando proposta": metade dos 70.
    expect(conta(eventos, estado({ stage: "analisando-proposta" })).score).toBe(35);
  });
});

describe("qualificação vale só a atual", () => {
  it("desqualificado depois de 'Experiente' perde os pontos de experiente", () => {
    const eventos = [
      evento("lead_qualified", "2026-09-14T09:00:00Z", { qualificacao: "experiente" }),
      evento("lead_qualified", HOJE, { qualificacao: "nao" }),
    ];
    expect(conta(eventos, estado({ qualification: "nao" })).score).toBe(0);
  });

  it("requalificado vale só a qualificação nova", () => {
    const eventos = [
      evento("lead_qualified", "2026-09-14T09:00:00Z", { qualificacao: "intermediario" }),
      evento("lead_qualified", HOJE, { qualificacao: "experiente" }),
    ];
    expect(conta(eventos, estado({ qualification: "experiente" })).score).toBe(60);
  });
});

describe("ações continuam somando", () => {
  it("cada visita ao site conta, ao lado da etapa e da qualificação", () => {
    const eventos = [
      evento("contact_created", HOJE),
      evento("site_visited", HOJE),
      evento("site_visited", HOJE),
      evento("lead_qualified", HOJE, { qualificacao: "intermediario" }),
      evento("lead_stage_changed", HOJE, { para: "qualificar-lead" }),
    ];
    const resultado = conta(
      eventos,
      estado({ stage: "qualificar-lead", qualification: "intermediario" })
    );
    // 10 + 3 + 3 + 20 + 10
    expect(resultado.score).toBe(46);
    expect(resultado.faixa).toBe("morno");
    expect(resultado.linhas).toHaveLength(5);
  });
});
