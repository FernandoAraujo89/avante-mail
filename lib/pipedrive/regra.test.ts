import { describe, expect, it } from "vitest";

import type { LeadQualificationRow, LeadStageRow } from "@/lib/db";

import { decidirPelosNegocios, type NegocioDoLead } from "./regra";

function etapa(slug: string, label: string, position: number): LeadStageRow {
  return {
    id: slug,
    slug,
    label,
    position,
    stopsNurturing: false,
    aliases: [],
    convertListId: null,
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const ETAPAS: LeadStageRow[] = [
  etapa("qualificado", "Lead captado", 10),
  etapa("realizar-contato", "Realizar contato", 30),
  etapa("qualificar-lead", "Qualificar lead", 40),
  etapa("apresentar-proposta-comercial", "Apresentar proposta comercial", 70),
  etapa("analisando-proposta", "Analisando proposta", 80),
  etapa("comprou", "Comprou", 100),
  etapa("perdido", "Perdido", 110),
];

const QUALIFICACOES = [
  { slug: "experiente", label: "Sim: Experiente" },
  { slug: "iniciante", label: "Sim: Iniciante" },
] as LeadQualificationRow[];

function negocio(
  status: string,
  stageName: string | null,
  updateTime: string,
  qualificacao: string | null = null
): NegocioDoLead {
  return { status, stageName, updateTime, qualificacao };
}

const decidir = (negocios: NegocioDoLead[], etapas = ETAPAS) =>
  decidirPelosNegocios(negocios, etapas, QUALIFICACOES);

describe("decidirPelosNegocios", () => {
  it("negócio aberto vence o perdido, mesmo o perdido sendo mais novo", () => {
    const d = decidir([
      negocio("open", "Realizar contato ", "2026-09-15T10:00:00Z"),
      negocio("lost", "Qualificar lead", "2026-09-15T12:00:00Z"),
    ]);
    expect(d.etapa?.slug).toBe("realizar-contato");
  });

  it("a decisão não depende da ordem em que os negócios chegam", () => {
    const a = negocio("open", "Realizar contato", "2026-09-15T10:00:00Z");
    const b = negocio("lost", "Qualificar lead", "2026-09-15T12:00:00Z");
    expect(decidir([a, b]).etapa?.slug).toBe(decidir([b, a]).etapa?.slug);
  });

  it("perdido só quando todos estão perdidos", () => {
    const d = decidir([
      negocio("lost", "Realizar contato", "2026-09-15T10:00:00Z"),
      negocio("lost", "Analisando proposta", "2026-09-15T12:00:00Z"),
    ]);
    expect(d.etapa?.slug).toBe("perdido");
  });

  it("sem a etapa Perdido cadastrada, todos perdidos não mexe", () => {
    const semPerdido = ETAPAS.filter((e) => e.slug !== "perdido");
    const d = decidir(
      [negocio("lost", "Realizar contato", "2026-09-15T10:00:00Z")],
      semPerdido
    );
    expect(d.etapa).toBeNull();
    expect(d.recusas).toBe(0);
  });

  it("ganho vence tudo, inclusive um aberto ao lado", () => {
    const d = decidir([
      negocio("open", "Analisando proposta", "2026-09-15T13:00:00Z"),
      negocio("won", "Analisando proposta", "2026-09-15T10:00:00Z"),
    ]);
    expect(d.etapa?.slug).toBe("comprou");
  });

  it("entre abertos vale o mais adiantado no funil", () => {
    const d = decidir([
      negocio("open", "Apresentar proposta comercial", "2026-09-15T10:00:00Z"),
      negocio("open", "Realizar contato", "2026-09-15T13:00:00Z"),
    ]);
    expect(d.etapa?.slug).toBe("apresentar-proposta-comercial");
  });

  it("aberto com etapa desconhecida não vira Perdido: não mexe e conta a recusa", () => {
    const d = decidir([
      negocio("open", "Follow-up 3", "2026-09-15T13:00:00Z"),
      negocio("lost", "Realizar contato", "2026-09-15T10:00:00Z"),
    ]);
    expect(d.etapa).toBeNull();
    expect(d.recusas).toBe(1);
  });

  it("excluído ou fora do funil não conta", () => {
    expect(
      decidir([
        negocio("fora", "Analisando proposta", "2026-09-15T13:00:00Z"),
        negocio("deleted", "Analisando proposta", "2026-09-15T13:00:00Z"),
      ]).etapa
    ).toBeNull();
    expect(
      decidir([
        negocio("fora", "Analisando proposta", "2026-09-15T13:00:00Z"),
        negocio("lost", "Realizar contato", "2026-09-15T10:00:00Z"),
      ]).etapa?.slug
    ).toBe("perdido");
  });

  it("qualificação vem do negócio que decidiu; se ele não tem, do mais recente que tem", () => {
    expect(
      decidir([
        negocio("open", "Realizar contato", "2026-09-15T10:00:00Z", "Sim: Iniciante"),
        negocio("lost", "Qualificar lead", "2026-09-15T12:00:00Z", "Sim: Experiente"),
      ]).qualificacao?.slug
    ).toBe("iniciante");
    expect(
      decidir([
        negocio("open", "Realizar contato", "2026-09-15T10:00:00Z"),
        negocio("lost", "Qualificar lead", "2026-09-15T12:00:00Z", "Sim: Experiente"),
      ]).qualificacao?.slug
    ).toBe("experiente");
  });

  it("sem negócio vivo, não mexe em nada", () => {
    expect(decidir([])).toEqual({ etapa: null, qualificacao: null, recusas: 0 });
  });
});
