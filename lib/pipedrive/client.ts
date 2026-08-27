/**
 * Cliente mínimo da API do Pipedrive — só o que a reconciliação lê.
 *
 * É uma INTERFACE de propósito: a sincronização recebe o cliente por
 * parâmetro, então dá para exercitá-la de ponta a ponta com um cliente de
 * mentira, sem token e sem rede — o que importa testar é a aplicação das
 * mudanças, não o HTTP.
 *
 * Token em PIPEDRIVE_API_TOKEN (Pipedrive → Preferências pessoais → API).
 * Nunca logar o token; os erros carregam só status e um pedaço do corpo.
 */

const BASE = "https://api.pipedrive.com";

export interface DealDoPipedrive {
  id: number;
  /** "open" | "won" | "lost" | "deleted" */
  status: string;
  stageId: number;
  personId: number | null;
  updateTime: string;
  /** Valor cru do campo de qualificação (id da opção, na API v2). */
  qualificacaoCrua: unknown;
}

export interface PessoaDoPipedrive {
  emails: string[];
  phones: string[];
}

export interface PipedriveApi {
  pipelines(): Promise<{ id: number; name: string }[]>;
  stages(pipelineId: number): Promise<Map<number, string>>;
  /** O campo de negócio com este nome; null quando não existe. */
  campoDeDeal(
    nome: string
  ): Promise<{ key: string; opcoes: Map<number, string> } | null>;
  deals(args: {
    pipelineId: number;
    campoKey: string | null;
    updatedSince?: string;
    cursor?: string;
  }): Promise<{ deals: DealDoPipedrive[]; nextCursor: string | null }>;
  pessoas(ids: number[]): Promise<Map<number, PessoaDoPipedrive>>;
}

async function chamar(
  token: string,
  caminho: string,
  params: Record<string, string | number | undefined>
): Promise<Record<string, unknown>> {
  const url = new URL(caminho, BASE);
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined) url.searchParams.set(chave, String(valor));
  }
  const res = await fetch(url, { headers: { "x-api-token": token } });
  if (!res.ok) {
    const corpo = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Pipedrive ${res.status} em ${caminho}: ${corpo}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

function lista(json: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(json.data)
    ? (json.data as Record<string, unknown>[])
    : [];
}

/** `emails: [{value}]` na v2, mas às vezes vem string crua — aceitar as duas. */
function valores(campo: unknown): string[] {
  if (!Array.isArray(campo)) return [];
  return campo
    .map((item) =>
      typeof item === "string"
        ? item
        : typeof (item as { value?: unknown })?.value === "string"
          ? ((item as { value: string }).value ?? "")
          : ""
    )
    .map((v) => v.trim())
    .filter(Boolean);
}

export function clientePipedrive(token: string): PipedriveApi {
  return {
    async pipelines() {
      const json = await chamar(token, "/api/v2/pipelines", { limit: 100 });
      return lista(json).map((p) => ({
        id: Number(p.id),
        name: String(p.name ?? ""),
      }));
    },

    async stages(pipelineId) {
      const json = await chamar(token, "/api/v2/stages", {
        pipeline_id: pipelineId,
        limit: 100,
      });
      return new Map(
        lista(json).map((s) => [Number(s.id), String(s.name ?? "").trim()])
      );
    },

    async campoDeDeal(nome) {
      // dealFields ainda é v1, paginada por start/limit.
      const alvo = nome.trim().toLowerCase();
      let start = 0;
      for (let pagina = 0; pagina < 10; pagina++) {
        const json = await chamar(token, "/v1/dealFields", {
          start,
          limit: 100,
        });
        for (const campo of lista(json)) {
          if (String(campo.name ?? "").trim().toLowerCase() !== alvo) continue;
          const opcoes = new Map<number, string>(
            Array.isArray(campo.options)
              ? (campo.options as { id: unknown; label: unknown }[]).map(
                  (o) => [Number(o.id), String(o.label ?? "").trim()]
                )
              : []
          );
          return { key: String(campo.key), opcoes };
        }
        const pag = (json.additional_data as Record<string, unknown> | undefined)
          ?.pagination as Record<string, unknown> | undefined;
        if (!pag?.more_items_in_collection) break;
        start = Number(pag.next_start ?? start + 100);
      }
      return null;
    },

    async deals({ pipelineId, campoKey, updatedSince, cursor }) {
      const json = await chamar(token, "/api/v2/deals", {
        pipeline_id: pipelineId,
        limit: 500,
        sort_by: "update_time",
        sort_direction: "asc",
        updated_since: updatedSince,
        cursor,
        custom_fields: campoKey ?? undefined,
      });
      const deals = lista(json).map((d) => {
        const custom = (d.custom_fields ?? {}) as Record<string, unknown>;
        return {
          id: Number(d.id),
          status: String(d.status ?? "open"),
          stageId: Number(d.stage_id ?? 0),
          personId: d.person_id === null ? null : Number(d.person_id),
          updateTime: String(d.update_time ?? ""),
          qualificacaoCrua: campoKey ? custom[campoKey] : null,
        };
      });
      const nextCursor =
        ((json.additional_data as Record<string, unknown> | undefined)
          ?.next_cursor as string | null | undefined) ?? null;
      return { deals, nextCursor };
    },

    async pessoas(ids) {
      const resultado = new Map<number, PessoaDoPipedrive>();
      for (let i = 0; i < ids.length; i += 100) {
        const lote = ids.slice(i, i + 100);
        const json = await chamar(token, "/api/v2/persons", {
          ids: lote.join(","),
          limit: 100,
        });
        for (const pessoa of lista(json)) {
          resultado.set(Number(pessoa.id), {
            emails: valores(pessoa.emails),
            phones: valores(pessoa.phones),
          });
        }
      }
      return resultado;
    },
  };
}
