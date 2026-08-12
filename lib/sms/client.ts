import twilio from "twilio";

import { getSmsConfig } from "./config";

// Cliente de envio de SMS (Twilio). Isolado no formato dos outros canais
// (lib/ses.ts, lib/whatsapp/client.ts): quem chama não conhece o SDK — recebe
// o id da mensagem ou um erro já classificado em permanente/transitório.
//
// Autenticação: API Key (SID + Secret) com o accountSid como escopo. A chave é
// RESTRICTED — Read/List/Create apenas em "messages". Nenhuma outra chamada da
// API funciona (403), então nenhuma outra existe aqui. O Auth Token NUNCA
// autentica chamada — só valida assinatura de webhook (lib/sms/webhook.ts).

let cachedClient: ReturnType<typeof twilio> | null = null;

function getClient(): ReturnType<typeof twilio> {
  if (cachedClient) return cachedClient;
  const config = getSmsConfig();
  cachedClient = twilio(config.apiKeySid, config.apiKeySecret, {
    accountSid: config.accountSid,
  });
  return cachedClient;
}

/** Erro da API da Twilio com o código original preservado. */
export class SmsApiError extends Error {
  /** Código de erro da Twilio (21614, 21610, 20429…), se houver. */
  readonly code: number | null;
  /** Status HTTP da resposta (400, 429, 500…). */
  readonly httpStatus: number;

  constructor(message: string, info: { code?: number | null; httpStatus: number }) {
    super(message);
    this.name = "SmsApiError";
    this.code = info.code ?? null;
    this.httpStatus = info.httpStatus;
  }
}

/**
 * Número inválido ou fixo (21614) e destinatário em opt-out (21610): além de
 * falha permanente, o CONTATO deve ser marcado para não receber de novo —
 * reenviar seria pagar para errar a mesma coisa.
 */
export const SMS_MARK_OPTED_OUT_CODES = new Set([21610, 21614]);

/** O erro pede a marcação do contato como fora do canal? */
export function shouldMarkSmsOptOut(error: unknown): boolean {
  return (
    error instanceof SmsApiError &&
    error.code !== null &&
    SMS_MARK_OPTED_OUT_CODES.has(error.code)
  );
}

/**
 * Vale tentar de novo? Só sobrecarga: 429 (limite de vazão) e 5xx (problema
 * do lado da Twilio). Erro 4xx de conteúdo/destinatário é definitivo —
 * repetir gastaria fila e dinheiro para falhar igual.
 */
export function isRetryableSmsError(error: unknown): boolean {
  if (error instanceof SmsApiError) {
    // httpStatus 0 = a chamada nem chegou a ter resposta (rede) — transitório.
    if (error.httpStatus === 0) return true;
    return error.httpStatus === 429 || error.httpStatus >= 500;
  }
  // Erro que não veio da API (rede, DNS): transitório por definição.
  return true;
}

export interface SendSmsResult {
  /** MessageSid (SM…) — gravado em campaign_sends.provider_message_id para
   *  casar os eventos do status callback. */
  sid: string;
}

/**
 * Envia um SMS pelo Messaging Service.
 *
 * SEMPRE messagingServiceSid, nunca `from`: a mensagem herda o pool de
 * remetentes, o opt-out avançado e futuros senders sem mudar código. O corpo
 * deve chegar SANEADO (sanitizeGsm7) — aqui não se mexe mais no texto, para o
 * que foi aprovado no editor ser exatamente o que sai.
 */
export async function sendSms(args: {
  to: string;
  body: string;
}): Promise<SendSmsResult> {
  const config = getSmsConfig();

  try {
    const message = await getClient().messages.create({
      to: args.to,
      body: args.body,
      messagingServiceSid: config.messagingServiceSid,
      statusCallback: config.statusCallbackUrl,
      // validityPeriod NÃO é passado de propósito: os 36000s já configurados
      // no Messaging Service valem para tudo; sobrescrever por mensagem
      // criaria duas fontes de verdade.
    });
    return { sid: message.sid };
  } catch (error) {
    throw toSmsApiError(error);
  }
}

/**
 * Converte o erro do SDK preservando código e status HTTP. A mensagem
 * original da Twilio é mantida — ela nomeia o problema ("not a valid phone
 * number") sem expor credencial nem corpo.
 */
function toSmsApiError(error: unknown): SmsApiError {
  if (error instanceof SmsApiError) return error;

  if (error && typeof error === "object") {
    const raw = error as { code?: unknown; status?: unknown; message?: unknown };
    const httpStatus = typeof raw.status === "number" ? raw.status : 0;
    if (httpStatus > 0) {
      return new SmsApiError(
        typeof raw.message === "string" ? raw.message : `Twilio respondeu ${httpStatus}.`,
        {
          code: typeof raw.code === "number" ? raw.code : null,
          httpStatus,
        }
      );
    }
  }

  // Sem resposta HTTP = falha de rede. httpStatus 0 mantém isRetryableSmsError
  // tratando como transitório.
  return new SmsApiError(
    error instanceof Error ? error.message : "Falha de rede ao chamar a Twilio.",
    { code: null, httpStatus: 0 }
  );
}

/** Reseta o singleton — só para os testes trocarem a configuração. */
export function __resetSmsClientForTests(): void {
  cachedClient = null;
}
