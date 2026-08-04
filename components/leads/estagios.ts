/** Estágios do funil, com o rótulo que a tela mostra. */
export const ESTAGIOS = [
  { valor: "novo", rotulo: "Novo" },
  { valor: "contatado", rotulo: "Contatado" },
  { valor: "qualificado", rotulo: "Qualificado" },
  { valor: "convertido", rotulo: "Convertido" },
  { valor: "perdido", rotulo: "Perdido" },
] as const;

export function estagioLabel(valor: string | null): string {
  return ESTAGIOS.find((e) => e.valor === valor)?.rotulo ?? (valor ?? "—");
}

/** Faixas do Lead Score, com a cor que cada uma pede na tela. */
export const FAIXAS = [
  { valor: "quente", rotulo: "Quente", variante: "destructive" as const },
  { valor: "morno", rotulo: "Morno", variante: "warning" as const },
  { valor: "frio", rotulo: "Frio", variante: "secondary" as const },
] as const;

export function faixaInfo(valor: string | null) {
  return FAIXAS.find((f) => f.valor === valor) ?? null;
}

export interface LeadDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  tags: string[] | null;
  stage: string | null;
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
