import { FONTES, fonteDe, type Fonte } from "@/lib/leads/fonte";
import type { Utm } from "@/lib/track/site";

/**
 * O PRIMEIRO TOQUE (fase 1.5 da E.3, docs/plano-webhooks-leads.md): de onde
 * a pessoa veio na primeira vez em que deixou pista.
 *
 * A costura traz o histórico anônimo para a ficha; este arquivo decide qual
 * dessas visitas responde "qual canal trouxe este lead" quando o formulário
 * não disse. Primeiro toque, e não último — a regra do plano (§3): a origem é
 * gravada uma vez e não é sobrescrita. Quem chega pelo Instagram, fecha, e
 * preenche o formulário dias depois numa visita direta continua "veio do
 * Instagram".
 *
 * Uma visita só conta como toque se carrega PISTA: UTM, ou referrer de fora.
 * Visita direta não diz nada; visita vinda do nosso próprio domínio (a home
 * mandando para /produtos, o blog para o site) também não — seria atribuir a
 * aquisição a nós mesmos.
 *
 * Puro: sem banco, sem rede. Recebe os eventos e os nossos hosts.
 */

export interface EventoDeSite {
  type: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

export interface PrimeiroToque {
  quando: Date;
  fonte: Fonte | null;
  utm: Utm | null;
  /** O host do referrer, só quando é de fora. */
  refHost: string | null;
  /** O caminho da página em que a pessoa entrou. */
  path: string | null;
}

/**
 * `blog.avantejuntos.com.br` é nosso se `www.avantejuntos.com.br` está na
 * lista: o `www.` cai e o resto casa por sufixo de domínio.
 */
export function ehHostProprio(host: string, hostsProprios: string[]): boolean {
  const h = host.toLowerCase();
  return hostsProprios.some((proprio) => {
    const apex = proprio.toLowerCase().replace(/^www\./, "");
    return Boolean(apex) && (h === apex || h.endsWith(`.${apex}`));
  });
}

const CHAVES_UTM = ["source", "medium", "campaign", "content", "term"] as const;

function utmDoPayload(payload: Record<string, unknown>): Utm | null {
  const cru = payload.utm;
  if (typeof cru !== "object" || cru === null || Array.isArray(cru)) return null;
  const utm: Utm = {};
  for (const chave of CHAVES_UTM) {
    const valor = (cru as Record<string, unknown>)[chave];
    if (typeof valor === "string" && valor) utm[chave] = valor;
  }
  return Object.keys(utm).length > 0 ? utm : null;
}

function fonteGravada(payload: Record<string, unknown>): Fonte | null {
  const valor = payload.fonte;
  return typeof valor === "string" && (FONTES as readonly string[]).includes(valor)
    ? (valor as Fonte)
    : null;
}

/** A visita mais antiga com pista, ou nulo quando nenhuma diz de onde veio. */
export function primeiroToque(
  eventos: EventoDeSite[],
  hostsProprios: string[]
): PrimeiroToque | null {
  const visitas = eventos
    .filter((e) => e.type === "site_visited" && e.payload)
    // Por data, e não pela ordem em que chegaram: a costura lê ordenado, mas
    // quem chama de outro lugar pode não ler.
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const visita of visitas) {
    const payload = visita.payload as Record<string, unknown>;
    const utm = utmDoPayload(payload);
    const refCru = typeof payload.refHost === "string" ? payload.refHost : null;
    const refHost =
      refCru && !ehHostProprio(refCru, hostsProprios) ? refCru : null;
    if (!utm && !refHost) continue;

    return {
      quando: visita.createdAt,
      // A fonte já gravada pela rota vale mais que recalcular: é o que a
      // pontuação usou. Sem ela (visita de antes da fase E.3), deriva.
      fonte: fonteGravada(payload) ?? fonteDe(utm?.source, refHost),
      utm,
      refHost,
      path: typeof payload.path === "string" ? payload.path : null,
    };
  }
  return null;
}
