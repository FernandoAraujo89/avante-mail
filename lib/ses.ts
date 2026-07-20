import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

/**
 * Cliente do Amazon SES (API v2), criado de forma lazy e reutilizado.
 * A região vem de SES_REGION (ou AWS_REGION); as credenciais são resolvidas
 * pela cadeia padrão do SDK (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY ou
 * IAM role da instância). São Paulo = sa-east-1.
 */
let cached: SESv2Client | undefined;

export function getSesClient(): SESv2Client {
  if (!cached) {
    const region =
      process.env.SES_REGION ?? process.env.AWS_REGION ?? "sa-east-1";
    cached = new SESv2Client({ region });
  }
  return cached;
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  /** Cabeçalhos extras (ex.: List-Unsubscribe). */
  headers?: Record<string, string>;
  /** Sobrescreve o remetente padrão (SES_FROM_EMAIL). */
  from?: string;
}

/**
 * Envia um e-mail pelo SES e devolve o MessageId — usado para casar os
 * eventos de devolução/reclamação (SNS) com o envio correspondente.
 */
export async function sendEmail(
  args: SendEmailArgs
): Promise<{ messageId: string }> {
  const from = args.from ?? process.env.SES_FROM_EMAIL;
  if (!from) {
    throw new Error("SES_FROM_EMAIL não definida.");
  }

  const headers = args.headers
    ? Object.entries(args.headers).map(([Name, Value]) => ({ Name, Value }))
    : undefined;

  const result = await getSesClient().send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [args.to] },
      Content: {
        Simple: {
          Subject: { Data: args.subject, Charset: "UTF-8" },
          Body: { Html: { Data: args.html, Charset: "UTF-8" } },
          ...(headers ? { Headers: headers } : {}),
        },
      },
    })
  );

  return { messageId: result.MessageId ?? "" };
}
