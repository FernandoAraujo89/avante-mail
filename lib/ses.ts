import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

/**
 * Envio de e-mail pelo Amazon SES via SMTP (nodemailer).
 * Configuração vem do .env.local:
 *  - SES_SMTP_HOST (padrão: email-smtp.<SES_REGION>.amazonaws.com)
 *  - SES_SMTP_PORT (padrão: 587, STARTTLS)
 *  - SES_SMTP_USER / SES_SMTP_PASSWORD (credenciais SMTP do SES)
 *  - SES_FROM_EMAIL (remetente verificado)
 * O transporter é criado de forma lazy e reutilizado.
 */
let cached: Transporter<SMTPTransport.SentMessageInfo> | undefined;

function getTransporter(): Transporter<SMTPTransport.SentMessageInfo> {
  if (!cached) {
    const region = process.env.SES_REGION ?? "sa-east-1";
    const host =
      process.env.SES_SMTP_HOST ?? `email-smtp.${region}.amazonaws.com`;
    const port = Number(process.env.SES_SMTP_PORT) || 587;

    const user = process.env.SES_SMTP_USER;
    const pass = process.env.SES_SMTP_PASSWORD;
    if (!user || !pass) {
      throw new Error("SES_SMTP_USER/SES_SMTP_PASSWORD não definidas.");
    }

    cached = nodemailer.createTransport({
      host,
      port,
      // 465 = TLS direto; 587 = STARTTLS.
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user, pass },
    });
  }
  return cached;
}

/**
 * O SES devolve o MessageId na resposta SMTP ("250 Ok <messageId>"). É esse
 * mesmo id que aparece em mail.messageId nas notificações do SNS, então o
 * usamos para casar as devoluções/reclamações com o envio.
 */
function extractSesMessageId(info: SMTPTransport.SentMessageInfo): string {
  const response = info.response ?? "";
  const match = response.match(/\bOk\s+(\S+)/i);
  if (match) return match[1];
  const parts = response.trim().split(/\s+/);
  return parts[parts.length - 1] || info.messageId || "";
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

export async function sendEmail(
  args: SendEmailArgs
): Promise<{ messageId: string }> {
  const from = args.from ?? process.env.SES_FROM_EMAIL;
  if (!from) {
    throw new Error("SES_FROM_EMAIL não definida.");
  }

  const info = await getTransporter().sendMail({
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    headers: args.headers,
  });

  return { messageId: extractSesMessageId(info) };
}
