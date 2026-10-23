/**
 * Cliente da API de leitura do NRG Hub (Marketing › Integrações › Tokens de
 * API) — só o que a reconciliação lê, na MESMA interface que o cliente do
 * Pipedrive (`lib/pipedrive/client.ts`): a sincronização não sabe de qual CRM
 * os negócios vêm.
 *
 * Documentação: https://app.nrg.ia.br/marketing/integracoes/api
 *   GET /api/v1/pipelines                 → [{ id, name, position }]
 *   GET /api/v1/pipelines/{id}/stages     → [{ id, name, position }]
 *   GET /api/v1/deals?pipeline_id&updated_since&limit&cursor
 *                                         → { data: [...], next_cursor }
 *   GET /api/v1/people?ids=a,b            → { data: [{ id, emails, phones }] }
 *   GET /api/v1/fields/qualification      → { key, label, options: [rótulos] }
 * Token no cabeçalho `Authorization: Bearer hub_…` (NRG_HUB_API_TOKEN); cada
 * token enxerga só os funis marcados nele. 120 chamadas por minuto por token
 * (429 com Retry-After). Datas em ISO 8601 com fuso. Nunca logar o token.
 *
 * Diferenças para o Pipedrive que a interface absorve: ids são UUIDs (texto);
 * a qualificação vem como RÓTULO ("Sim: Experiente"), não como id de opção —
 * por isso as opções do campo são um mapa rótulo → rótulo; a pessoa é o
 * `contact_id` do negócio.
 */

import type {
  DealDoPipedrive,
  PessoaDoPipedrive,
  PipedriveApi,
} from "@/lib/pipedrive/client";

export const NRG_HUB_URL_PADRAO = "https://app.nrg.ia.br";

type Json = Record<string, unknown>;
type Buscador = (url: string, init: RequestInit) => Promise<Response>;

function lista(json: unknown): Json[] {
  if (Array.isArray(json)) return json as Json[];
  const data = (json as Json | null)?.data;
  return Array.isArray(data) ? (data as Json[]) : [];
}

function textos(campo: unknown): string[] {
  if (!Array.isArray(campo)) return [];
  return campo
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();

export function clienteNrgHub(
  token: string,
  base: string = NRG_HUB_URL_PADRAO,
  buscar: Buscador = (url, init) => fetch(url, init)
): PipedriveApi {
  const raiz = base.replace(/\/+$/, "") + "/api/v1";

  async function chamar(
    caminho: string,
    params: Record<string, string | number | undefined> = {},
    tentativa = 0
  ): Promise<unknown> {
    const url = new URL(raiz + caminho);
    for (const [chave, valor] of Object.entries(params)) {
      if (valor !== undefined && valor !== "") url.searchParams.set(chave, String(valor));
    }
    const res = await buscar(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    // Limite por minuto: espera o que o Hub pede (uma vez) e repete.
    if (res.status === 429 && tentativa === 0) {
      const segundos = Number(res.headers.get("retry-after") ?? "5");
      await new Promise((r) => setTimeout(r, Math.min(Math.max(segundos, 1), 60) * 1000));
      return chamar(caminho, params, 1);
    }
    if (!res.ok) {
      const corpo = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`NRG Hub ${res.status} em ${caminho}: ${corpo}`);
    }
    return res.json();
  }

  return {
    async pipelines() {
      const json = await chamar("/pipelines");
      return lista(json).map((p) => ({ id: texto(p.id), name: texto(p.name) }));
    },

    async stages(pipelineId) {
      const json = await chamar(`/pipelines/${encodeURIComponent(pipelineId)}/stages`);
      return new Map(lista(json).map((s) => [texto(s.id), texto(s.name)]));
    },

    async campoDeDeal(nome) {
      // O Hub tem um campo só de qualificação; o nome pedido é ignorado de
      // propósito (a env PIPEDRIVE_CAMPO_QUALIFICACAO não vale aqui).
      void nome;
      const json = (await chamar("/fields/qualification")) as Json | null;
      const opcoes = textos(json?.options);
      if (!json?.key || opcoes.length === 0) return null;
      return { key: texto(json.key), opcoes: new Map(opcoes.map((o) => [o, o])) };
    },

    async deals({ pipelineId, updatedSince, cursor }) {
      const json = (await chamar("/deals", {
        pipeline_id: pipelineId,
        updated_since: updatedSince,
        limit: 500,
        cursor,
      })) as Json | null;
      const deals: DealDoPipedrive[] = lista(json).map((d) => ({
        id: texto(d.id),
        status: texto(d.situacao) || "open",
        stageId: texto(d.stage_id),
        personId: d.contact_id ? texto(d.contact_id) : null,
        updateTime: texto(d.alterado_em),
        qualificacaoCrua: typeof d.qualificacao === "string" && d.qualificacao.trim() ? d.qualificacao.trim() : null,
      }));
      const nextCursor = typeof json?.next_cursor === "string" && json.next_cursor ? json.next_cursor : null;
      return { deals, nextCursor };
    },

    async pessoas(ids) {
      const resultado = new Map<string, PessoaDoPipedrive>();
      for (let i = 0; i < ids.length; i += 100) {
        const lote = ids.slice(i, i + 100);
        const json = await chamar("/people", { ids: lote.join(",") });
        for (const pessoa of lista(json)) {
          resultado.set(texto(pessoa.id), {
            emails: textos(pessoa.emails),
            phones: textos(pessoa.phones),
          });
        }
      }
      return resultado;
    },
  };
}
