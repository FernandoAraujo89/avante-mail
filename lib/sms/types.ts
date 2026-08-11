// Constantes do canal SMS (Twilio).
//
// Espelha lib/whatsapp/types.ts: o preço fica numa constante compartilhada
// porque o editor de campanha (client component) precisa estimar o custo em
// tempo real, e process.env não existe no navegador. O servidor pode
// sobrescrever por env em lib/pricing.ts — a constante é o padrão, não a
// única fonte.

/**
 * Preço da Twilio por SEGMENTO de SMS para o Brasil, em US$.
 *
 * Segmento, não mensagem: um texto de 300 caracteres em GSM-7 são 2 segmentos
 * e custa o dobro. É por isso que o sanitizador existe — um único emoji
 * derruba a mensagem para UCS-2 (70 caracteres por segmento) e pode triplicar
 * a conta sem ninguém perceber.
 */
export const SMS_BRAZIL_PRICE_PER_SEGMENT_USD = 0.0599;

/** Limites de septetos do GSM 03.38 (7 bits por caractere). */
export const GSM7_SINGLE_LIMIT = 160;
/**
 * Numa mensagem concatenada, 7 septetos de cada segmento vão para o cabeçalho
 * (UDH) que ensina o aparelho a remontar as partes na ordem.
 */
export const GSM7_CONCAT_LIMIT = 153;

/** Limites em unidades UTF-16 quando a mensagem cai para UCS-2. */
export const UCS2_SINGLE_LIMIT = 70;
export const UCS2_CONCAT_LIMIT = 67;

export type SmsEncoding = "gsm7" | "ucs2";
