import { describe, expect, it } from "vitest";

import type { LeadStageRow } from "@/lib/db";

import { casarEtapa, passaramPorEtapa } from "./etapas";

function etapa(
  slug: string,
  label: string,
  position: number,
  extras: Partial<LeadStageRow> = {}
): LeadStageRow {
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
    ...extras,
  };
}

// O funil depois de scripts/migrate-sincroniza-funil-completo.ts.
const FUNIL: LeadStageRow[] = [
  etapa("qualificado", "Lead captado", 10),
  etapa("pesquisa", "Pesquisa", 20),
  etapa("realizar-contato", "Realizar contato", 30),
  etapa("qualificar-lead", "Qualificar lead", 40),
  etapa("agendar-apresentacao-parte-tecnica", "Agendar apresentação parte técnica", 50, {
    aliases: ["Em análise/Agendar apresentação"],
  }),
  etapa("apresentar-parte-tecnica", "Apresentar parte técnica", 60),
  etapa("apresentacao-de-produto", "Passou por apresentação de produto", 61, {
    active: false,
  }),
  etapa("apresentar-proposta-comercial", "Apresentar proposta comercial", 70),
  etapa("analisando-proposta", "Analisando proposta", 80),
  etapa("aguardar-assinatura-e-pagamento", "Aguardar assinatura e pagamento", 90),
  etapa("comprou", "Comprou", 100, { stopsNurturing: true }),
];

describe("casarEtapa com os nomes crus dos dois funis", () => {
  // Exatamente como a API devolveu em 14/09/2026 — espaço sobrando, espaço
  // duplo e maiúscula diferente entre os funis.
  const casos: [string, string][] = [
    // 8 — White Label - Inbound
    ["Pesquisa", "pesquisa"],
    ["Realizar contato ", "realizar-contato"],
    ["Qualificar lead", "qualificar-lead"],
    ["Agendar apresentação parte técnica", "agendar-apresentacao-parte-tecnica"],
    ["Apresentar parte técnica", "apresentar-parte-tecnica"],
    ["Apresentar proposta comercial", "apresentar-proposta-comercial"],
    ["Analisando proposta", "analisando-proposta"],
    ["Aguardar assinatura  e pagamento", "aguardar-assinatura-e-pagamento"],
    // 14 — SDR-TESTE-NRG
    ["Realizar Contato", "realizar-contato"],
    ["Em análise/Agendar apresentação ", "agendar-apresentacao-parte-tecnica"],
  ];

  for (const [nome, slug] of casos) {
    it(`"${nome}" → ${slug}`, () => {
      expect(casarEtapa(FUNIL, nome)?.slug).toBe(slug);
    });
  }

  it("um apelido velho na etapa de entrada venceria a etapa certa", () => {
    // É o que a migração evita ao tirar da entrada os apelidos que viraram
    // etapa: a busca por apelido segue a ordem do funil.
    const comApelidoVelho = FUNIL.map((e) =>
      e.slug === "qualificado"
        ? { ...e, aliases: ["Em análise/Agendar apresentação"] }
        : e
    );
    expect(
      casarEtapa(comApelidoVelho, "Em análise/Agendar apresentação")?.slug
    ).toBe("qualificado");
  });

  it("etapa que só existe no Pipedrive não casa", () => {
    expect(casarEtapa(FUNIL, "Follow-up 3")).toBeNull();
  });
});

describe("passaramPorEtapa", () => {
  const posicoes = FUNIL.filter((e) => e.active).map((e) => e.position);

  it("quem pulou etapa conta em todas até onde chegou", () => {
    const alcances = [
      80, // arrastado de "Realizar contato" direto para "Analisando proposta"
      30, // parado em "Realizar contato"
      10, // só captado
      100, // comprou
      61, // passou pelo marco antigo de apresentação
    ];
    expect(passaramPorEtapa(posicoes, alcances)).toEqual([
      5, // Lead captado
      4, // Pesquisa
      4, // Realizar contato
      3, // Qualificar lead
      3, // Agendar apresentação
      3, // Apresentar parte técnica (o marco antigo conta até aqui)
      2, // Apresentar proposta comercial
      2, // Analisando proposta
      1, // Aguardar assinatura
      1, // Comprou
    ]);
  });

  it("o funil nunca sobe de uma etapa para a seguinte", () => {
    const alcances = [20, 90, 40, 40, 100, 60, 10, 70, 30, 50];
    const contagem = passaramPorEtapa(posicoes, alcances);
    for (let i = 1; i < contagem.length; i++) {
      expect(contagem[i]).toBeLessThanOrEqual(contagem[i - 1]);
    }
  });
});
