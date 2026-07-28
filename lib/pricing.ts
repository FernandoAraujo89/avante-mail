import { WHATSAPP_BRAZIL_PRICE_USD } from "@/lib/whatsapp/types";

/**
 * Custo dos envios por canal. A AWS (SES) e a Meta (WhatsApp) cobram em US$;
 * o R$ é uma conversão para exibição, no câmbio configurado (aproximação — o
 * valor real depende da fatura e do câmbio do dia da cobrança).
 *
 * Envs (opcionais):
 *  - SES_PRICE_PER_EMAIL_USD  preço por e-mail enviado. Padrão 0,0001
 *    (US$ 0,10 / 1.000, tabela padrão do SES). Ponha 0 se estiver no free tier.
 *  - USD_BRL_RATE             câmbio US$→R$ para exibição. Padrão 5,40.
 */

export function sesPricePerEmailUsd(): number {
  const value = Number(process.env.SES_PRICE_PER_EMAIL_USD);
  return Number.isFinite(value) && value >= 0 ? value : 0.0001;
}

export function usdToBrlRate(): number {
  const value = Number(process.env.USD_BRL_RATE);
  return Number.isFinite(value) && value > 0 ? value : 5.4;
}

/** Tarifa (US$) da mensagem de WhatsApp por categoria (Brasil). */
export function whatsAppPriceUsd(category: string | null | undefined): number {
  const key = (category ?? "MARKETING").toUpperCase();
  return WHATSAPP_BRAZIL_PRICE_USD[key] ?? WHATSAPP_BRAZIL_PRICE_USD.MARKETING;
}

export interface CampaignCost {
  /** Unidades cobradas: e-mails enviados ao SES / mensagens entregues no WhatsApp. */
  chargeable: number;
  /** Preço unitário em US$. */
  unitUsd: number;
  usd: number;
  brl: number;
}

/**
 * Custo de uma campanha a partir da quantidade cobrável.
 * - E-mail: cobra por e-mail aceito pelo SES (todo envio com sentAt, inclusive
 *   os que depois devolveram).
 * - WhatsApp: cobra por mensagem entregue (deliveredAt), na tarifa da categoria
 *   do modelo. Falhas (ex.: 131049) não são cobradas.
 */
export function campaignCost(args: {
  channel: string;
  chargeable: number;
  whatsappCategory?: string | null;
}): CampaignCost {
  const unitUsd =
    args.channel === "whatsapp"
      ? whatsAppPriceUsd(args.whatsappCategory)
      : sesPricePerEmailUsd();
  const usd = args.chargeable * unitUsd;
  return { chargeable: args.chargeable, unitUsd, usd, brl: usd * usdToBrlRate() };
}
