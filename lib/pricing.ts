import { estimateSmsCostUsd } from "@/lib/sms/gsm7";
import { SMS_BRAZIL_PRICE_PER_SEGMENT_USD } from "@/lib/sms/types";
import { WHATSAPP_BRAZIL_PRICE_USD } from "@/lib/whatsapp/types";

/**
 * Custo dos envios por canal. A AWS (SES), a Meta (WhatsApp) e a Twilio (SMS)
 * cobram em US$; o R$ é uma conversão para exibição, no câmbio configurado
 * (aproximação — o valor real depende da fatura e do câmbio do dia da
 * cobrança).
 *
 * Envs (opcionais):
 *  - SES_PRICE_PER_EMAIL_USD    preço por e-mail enviado. Padrão 0,0001
 *    (US$ 0,10 / 1.000, tabela padrão do SES). Ponha 0 se estiver no free tier.
 *  - SMS_PRICE_PER_SEGMENT_USD  preço por SEGMENTO de SMS. Padrão 0,0599
 *    (tabela Brasil da Twilio). Só mude se a sua tarifa for negociada.
 *  - USD_BRL_RATE               câmbio US$→R$ para exibição. Padrão 5,40.
 */

export function sesPricePerEmailUsd(): number {
  const value = Number(process.env.SES_PRICE_PER_EMAIL_USD);
  return Number.isFinite(value) && value >= 0 ? value : 0.0001;
}

/**
 * Tarifa (US$) do SEGMENTO de SMS no Brasil.
 *
 * Env vazia cai no padrão em vez de virar zero: no SES o free tier torna "0"
 * um valor legítimo, mas SMS de graça não existe — uma linha
 * `SMS_PRICE_PER_SEGMENT_USD=` esquecida no .env zeraria a conta do canal mais
 * caro dos três sem ninguém notar.
 */
export function smsPricePerSegmentUsd(): number {
  const raw = process.env.SMS_PRICE_PER_SEGMENT_USD;
  if (raw === undefined || raw.trim() === "") {
    return SMS_BRAZIL_PRICE_PER_SEGMENT_USD;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? value
    : SMS_BRAZIL_PRICE_PER_SEGMENT_USD;
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
  /** Envios cobrados: e-mails aceitos pelo SES / mensagens entregues no WhatsApp / SMS que saíram. */
  chargeable: number;
  /**
   * Preço em US$ da unidade de cobrança do canal: o e-mail, a mensagem de
   * WhatsApp — ou, no SMS, o SEGMENTO (que não é a mensagem).
   */
  unitUsd: number;
  /** Só no SMS: total de segmentos cobrados, que é o que multiplica a tarifa. */
  smsSegments?: number;
  usd: number;
  brl: number;
}

/**
 * Custo de uma campanha a partir da quantidade cobrável.
 * - E-mail: cobra por e-mail aceito pelo SES (todo envio com sentAt, inclusive
 *   os que depois devolveram).
 * - WhatsApp: cobra por mensagem entregue (deliveredAt), na tarifa da categoria
 *   do modelo. Falhas (ex.: 131049) não são cobradas.
 * - SMS: cobra por SEGMENTO, no momento em que a Twilio entrega a mensagem à
 *   operadora — ou seja, conta `sentAt`, como o e-mail, e NÃO `deliveredAt`
 *   como o WhatsApp: a operadora nem sempre confirma a entrega, mas o segmento
 *   já foi pago de qualquer jeito. Por isso `chargeable` (envios) não basta
 *   aqui: uma mensagem de 200 caracteres custa o dobro de uma de 100, e a conta
 *   é a SOMA dos segmentos de cada envio × a tarifa.
 */
export function campaignCost(args: {
  channel: string;
  chargeable: number;
  whatsappCategory?: string | null;
  /**
   * Só no SMS: soma dos segmentos cobrados dos envios contados em
   * `chargeable`. Omitido, cada envio conta como 1 segmento.
   */
  smsSegments?: number | null;
}): CampaignCost {
  if (args.channel === "sms") {
    const unitUsd = smsPricePerSegmentUsd();
    // Envio sem segmento gravado (linha anterior à coluna sms_segments) vale 1:
    // nenhum SMS custa menos que um segmento, e errar para baixo esconde
    // despesa — o erro caro é o relatório dizer que o canal saiu de graça.
    const smsSegments = args.smsSegments ?? args.chargeable;
    // Destinatários = 1 porque `smsSegments` já é a soma de TODOS os envios;
    // multiplicar de novo cobraria a campanha inteira por destinatário.
    const usd = estimateSmsCostUsd(smsSegments, 1, unitUsd);
    return {
      chargeable: args.chargeable,
      unitUsd,
      smsSegments,
      usd,
      brl: usd * usdToBrlRate(),
    };
  }

  const unitUsd =
    args.channel === "whatsapp"
      ? whatsAppPriceUsd(args.whatsappCategory)
      : sesPricePerEmailUsd();
  const usd = args.chargeable * unitUsd;
  return { chargeable: args.chargeable, unitUsd, usd, brl: usd * usdToBrlRate() };
}
