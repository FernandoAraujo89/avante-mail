/**
 * O caminho de volta: o Campanhas manda ao NRG Hub cada lead que captou pelos
 * formulários, para que TODO lead exista no Hub (e, por isso, tenha funil).
 *
 * O Hub recebe por "Marketing › Fontes de lead" (captação por webhook): um
 * POST JSON na URL da fonte, com `phone` obrigatório e `name`, `email`,
 * `company`, `external_id` e `utm_*` opcionais. A fonte decide em qual funil
 * e etapa o lead entra. A URL (com o segredo dela) fica em
 * NRG_HUB_CAPTACAO_URL; sem a env, nada é enviado — comportamento antigo.
 *
 * Nunca mandar de volta o que veio do próprio Hub (origem `nrg-hub`): seria
 * um laço. `external_id` leva o id do contato daqui, para o Hub não duplicar.
 */

export interface LeadParaOHub {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  /** De onde o lead veio aqui (nome da origem), vai como título. */
  origem?: string | null;
}

/** O corpo que a fonte do Hub aceita; null quando o lead não tem telefone (obrigatório lá). */
export function corpoDaCaptacao(lead: LeadParaOHub): Record<string, string> | null {
  const phone = lead.phone?.trim();
  if (!phone) return null;
  const corpo: Record<string, string> = { phone, external_id: lead.id };
  const opcional: [string, string | null | undefined][] = [
    ["name", lead.name],
    ["email", lead.email],
    ["company", lead.company],
    ["title", lead.origem ? `Lead do Campanhas · ${lead.origem}` : "Lead do Campanhas"],
    ["utm_source", lead.utmSource],
    ["utm_medium", lead.utmMedium],
    ["utm_campaign", lead.utmCampaign],
    ["utm_content", lead.utmContent],
    ["utm_term", lead.utmTerm],
  ];
  for (const [chave, valor] of opcional) {
    const v = valor?.trim();
    if (v) corpo[chave] = v;
  }
  return corpo;
}

export type ResultadoDaCaptacao =
  | { ok: true; status: number }
  | { ok: false; motivo: "sem-url" | "sem-telefone" | "falha"; status?: number; detalhe?: string };

export async function enviarLeadAoHub(
  lead: LeadParaOHub,
  opcoes: { url?: string; buscar?: (url: string, init: RequestInit) => Promise<Response> } = {}
): Promise<ResultadoDaCaptacao> {
  const url = opcoes.url ?? process.env.NRG_HUB_CAPTACAO_URL;
  if (!url) return { ok: false, motivo: "sem-url" };
  const corpo = corpoDaCaptacao(lead);
  if (!corpo) return { ok: false, motivo: "sem-telefone" };
  const buscar = opcoes.buscar ?? ((u, init) => fetch(u, init));
  try {
    const res = await buscar(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detalhe = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, motivo: "falha", status: res.status, detalhe };
    }
    return { ok: true, status: res.status };
  } catch (error) {
    return { ok: false, motivo: "falha", detalhe: error instanceof Error ? error.message : String(error) };
  }
}
