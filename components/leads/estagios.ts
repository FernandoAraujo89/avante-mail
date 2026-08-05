/**
 * Estágios, na ordem do ciclo. Descrevem o que ESTE sistema faz — nutrir,
 * entregar, registrar o desfecho —, não o funil do comercial, que vive no
 * Pipedrive.
 */
export const ESTAGIOS = [
  { valor: "nutrindo", rotulo: "Nutrindo", variante: "info" as const },
  {
    valor: "enviado",
    rotulo: "Enviado ao comercial",
    variante: "warning" as const,
  },
  { valor: "cliente", rotulo: "Virou cliente", variante: "success" as const },
  { valor: "descartado", rotulo: "Descartado", variante: "secondary" as const },
] as const;

/** O estágio de quem acaba de entrar. */
export const ESTAGIO_INICIAL = "nutrindo";

export function estagioInfo(valor: string | null) {
  return ESTAGIOS.find((e) => e.valor === valor) ?? null;
}

export function estagioLabel(valor: string | null): string {
  return ESTAGIOS.find((e) => e.valor === valor)?.rotulo ?? (valor ?? "—");
}

/**
 * Faixas do Lead Score, do mais quente para o mais frio.
 *
 * Faixa é TEMPERATURA (o sistema calcula); estágio é PROPÓSITO (uma pessoa
 * decide). Os dois vocabulários são separados de propósito para não colidirem
 * na mesma linha da tabela.
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
  enviadoAoComercialEm: string | null;
}
