import { describe, expect, it } from "vitest";

import { clienteNrgHub } from "./client";

function respostas(mapa: Record<string, unknown>) {
  const chamadas: string[] = [];
  const buscar = async (url: string, init: RequestInit) => {
    chamadas.push(url);
    const auth = (init.headers as Record<string, string>).Authorization;
    if (auth !== "Bearer hub_teste") return new Response("{\"error\":\"401\"}", { status: 401 });
    const u = new URL(url);
    const chave = u.pathname.replace("/api/v1", "") + (u.search ? "?" + [...u.searchParams.keys()].sort().join(",") : "");
    const corpo = mapa[chave];
    if (corpo === undefined) return new Response("{\"error\":\"nao mapeado\"}", { status: 404 });
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { buscar, chamadas };
}

describe("clienteNrgHub", () => {
  it("lê funis, etapas e opções de qualificação com ids em texto", async () => {
    const { buscar } = respostas({
      "/pipelines": [{ id: "f1", name: "White Label - Inbound", position: 0 }],
      "/pipelines/f1/stages": [
        { id: "e1", name: "Pesquisa", position: 0 },
        { id: "e2", name: "Realizar contato", position: 1 },
      ],
      "/fields/qualification": { key: "lead_qualificado", label: "Lead qualificado", options: ["Sim: Experiente", "Não"] },
    });
    const api = clienteNrgHub("hub_teste", "https://hub.exemplo", buscar);
    expect(await api.pipelines()).toEqual([{ id: "f1", name: "White Label - Inbound" }]);
    expect([...(await api.stages("f1"))]).toEqual([
      ["e1", "Pesquisa"],
      ["e2", "Realizar contato"],
    ]);
    const campo = await api.campoDeDeal("qualquer nome");
    expect(campo?.key).toBe("lead_qualificado");
    expect(campo?.opcoes.get("Sim: Experiente")).toBe("Sim: Experiente");
  });

  it("traduz o negócio do Hub para o formato da sincronização e pagina pelo cursor", async () => {
    const { buscar, chamadas } = respostas({
      "/deals?limit,pipeline_id,updated_since": {
        data: [
          {
            id: "n1",
            situacao: "won",
            stage_id: "e2",
            contact_id: "p1",
            alterado_em: "2026-10-22T13:05:41.123456+00:00",
            qualificacao: "Sim: Experiente",
          },
          { id: "n2", situacao: "open", stage_id: "e1", contact_id: null, alterado_em: "2026-10-22T14:00:00+00:00", qualificacao: "" },
        ],
        next_cursor: "abc",
      },
      "/deals?cursor,limit,pipeline_id,updated_since": { data: [], next_cursor: null },
      "/people?ids": { data: [{ id: "p1", emails: ["ana@acme.com"], phones: ["+5531999998888"] }] },
    });
    const api = clienteNrgHub("hub_teste", "https://hub.exemplo/", buscar);
    const pagina = await api.deals({ pipelineId: "f1", campoKey: "lead_qualificado", updatedSince: "2026-10-01T00:00:00-03:00" });
    expect(pagina.deals).toEqual([
      { id: "n1", status: "won", stageId: "e2", personId: "p1", updateTime: "2026-10-22T13:05:41.123456+00:00", qualificacaoCrua: "Sim: Experiente" },
      { id: "n2", status: "open", stageId: "e1", personId: null, updateTime: "2026-10-22T14:00:00+00:00", qualificacaoCrua: null },
    ]);
    expect(pagina.nextCursor).toBe("abc");
    const seguinte = await api.deals({ pipelineId: "f1", campoKey: null, updatedSince: "2026-10-01T00:00:00-03:00", cursor: "abc" });
    expect(seguinte.deals).toEqual([]);
    expect(seguinte.nextCursor).toBeNull();
    expect(chamadas[0]).toContain("limit=500");
    expect(chamadas[0]).toContain("updated_since=2026-10-01T00%3A00%3A00-03%3A00");

    const pessoas = await api.pessoas(["p1"]);
    expect(pessoas.get("p1")).toEqual({ emails: ["ana@acme.com"], phones: ["+5531999998888"] });
  });

  it("erro do Hub vira exceção com status e caminho, sem o token", async () => {
    const api = clienteNrgHub("hub_errado", "https://hub.exemplo", respostas({}).buscar);
    await expect(api.pipelines()).rejects.toThrow(/NRG Hub 401 em \/pipelines/);
  });
});
