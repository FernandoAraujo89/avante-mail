/**
 * Faixas do Lead Score, do mais quente para o mais frio.
 *
 * Três vocabulários convivem na ficha do lead, e eles NÃO são a mesma coisa:
 *
 *   FAIXA         temperatura — o sistema calcula (este arquivo)
 *   QUALIFICAÇÃO  quem o lead é — o agente decide (qualificacoes.ts)
 *   ETAPA         onde ele está no funil do Pipedrive — chega por webhook
 *                 (tabela `lead_stages`, lida por /api/leads/etapas)
 *
 * As cores acompanham a escalada, e a barra de calor carrega o degradê exato.
 */
export const FAIXAS = [
  { valor: "quente", rotulo: "Quente", variante: "destructive" as const },
  { valor: "aquecido", rotulo: "Aquecido", variante: "warning" as const },
  { valor: "morno", rotulo: "Morno", variante: "info" as const },
  { valor: "frio", rotulo: "Frio", variante: "secondary" as const },
] as const;

export function faixaInfo(valor: string | null) {
  return FAIXAS.find((f) => f.valor === valor) ?? null;
}

/**
 * Etapa em que o lead entra quando o webhook não manda nenhuma.
 *
 * Mora neste arquivo puro, e não em `lib/leads/etapas.ts`, porque o cadastro de
 * origens (tela) e o `limparDefaults` (que a tela também usa) precisam dela —
 * e aquele módulo toca o banco.
 */
export const ETAPA_DE_ENTRADA = "qualificado";

/**
 * Normaliza o que vem de fora para virar slug.
 *
 * O agente manda o rótulo do Pipedrive ("Passou por apresentação de produto"),
 * não um slug — casar só por igualdade exata faria o webhook ser recusado por
 * um acento ou uma maiúscula. Aqui as duas formas chegam ao mesmo lugar.
 */
export function slugDaEtapa(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Uma etapa do funil, do jeito que a API a entrega. */
export interface EtapaDto {
  id: string;
  slug: string;
  label: string;
  position: number;
  stopsNurturing: boolean;
  active: boolean;
}

export function etapaLabel(
  etapas: EtapaDto[],
  slug: string | null
): string {
  if (!slug) return "—";
  return etapas.find((e) => e.slug === slug)?.label ?? slug;
}

export interface LeadDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  tags: string[] | null;
  stage: string | null;
  stageChangedAt: string | null;
  qualification: string | null;
  subscribed: boolean;
  whatsappSubscribed: boolean;
  sourceChannel: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  landingPage: string | null;
  sourceDetail: string | null;
  acquiredAt: string | null;
  createdAt: string;
  leadScore: number | null;
  leadScoreBand: string | null;
}
