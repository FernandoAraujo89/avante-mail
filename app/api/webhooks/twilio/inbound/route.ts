import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";

import { contatoPorTelefone, optOutTelefone } from "@/lib/contatos/enderecos";
import { campaignSends, getDb } from "@/lib/db";
import { emitContactEvent } from "@/lib/events";
import { errorMessage } from "@/lib/utils";
import {
  EMPTY_TWIML,
  formParamsToRecord,
  isSmsOptOutMessage,
  publicWebhookUrl,
  verifyTwilioSignature,
} from "@/lib/sms/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Inbound de SMS (respostas dos destinatários) — form-urlencoded, assinado.
 *
 * Registra a resposta no envio mais recente e trata o opt-out por palavra
 * (PARAR/SAIR/CANCELAR/DESCADASTRAR/REMOVER) NA NOSSA BASE — a Twilio já
 * bloqueia do lado dela (Advanced Opt-Out), mas sem o registro local o painel
 * acharia que o contato continua alcançável.
 *
 * Resposta: TwiML VAZIO. A confirmação de opt-out está configurada no
 * Messaging Service; responder aqui mandaria (e cobraria) em dobro.
 *
 * O Messaging Service ainda está com Incoming Messages = "Receive the
 * message" — este endpoint só recebe tráfego depois da troca manual para
 * "Send a webhook" no console.
 */
export async function POST(request: NextRequest) {
  let params: Record<string, string>;
  try {
    params = formParamsToRecord(await request.formData());
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const check = verifyTwilioSignature({
    authToken: process.env.TWILIO_AUTH_TOKEN,
    signature: request.headers.get("x-twilio-signature"),
    url: publicWebhookUrl({
      forwardedProto: request.headers.get("x-forwarded-proto"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      host: request.headers.get("host"),
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
    }),
    params,
  });
  if (!check.ok) {
    if (!check.configured) {
      return NextResponse.json(
        { error: "TWILIO_AUTH_TOKEN não configurado." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 403 });
  }

  try {
    await processInbound(params);
  } catch (error) {
    console.error(
      "[WEBHOOK-SMS] Erro ao processar inbound:",
      JSON.stringify({
        messageSid: params.MessageSid ?? null,
        error: errorMessage(error),
      })
    );
  }

  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

async function processInbound(params: Record<string, string>): Promise<void> {
  const from = params.From;
  if (!from) return;
  const db = getDb();

  // From já vem em E.164. É o NÚMERO que escreveu — pode ser o segundo
  // telefone do contato.
  const telefone = await contatoPorTelefone(db, from);
  if (!telefone) return; // resposta de número fora da base
  const contato = { id: telefone.contactId, smsSubscribed: telefone.smsSubscribed };

  // Resposta no envio de SMS mais recente ainda sem resposta (relatório).
  const [ultimoEnvio] = await db
    .select({ id: campaignSends.id, campaignId: campaignSends.campaignId })
    .from(campaignSends)
    .where(
      and(
        eq(campaignSends.contactId, contato.id),
        eq(campaignSends.channel, "sms"),
        isNull(campaignSends.repliedAt)
      )
    )
    .orderBy(desc(campaignSends.sentAt))
    .limit(1);

  if (ultimoEnvio) {
    await db
      .update(campaignSends)
      .set({ repliedAt: new Date() })
      .where(eq(campaignSends.id, ultimoEnvio.id));
  }

  await emitContactEvent("sms_replied", contato.id, {
    campaignId: ultimoEnvio?.campaignId ?? null,
    sendId: ultimoEnvio?.id ?? null,
  });

  console.log(
    "[WEBHOOK-SMS]",
    JSON.stringify({
      messageSid: params.MessageSid ?? null,
      campaignId: ultimoEnvio?.campaignId ?? null,
      inbound: true,
      optOut: isSmsOptOutMessage(params.Body),
    })
  );

  // Sai só este número. O evento é do contato: só quando não sobra número
  // aceitando SMS.
  if (isSmsOptOutMessage(params.Body) && contato.smsSubscribed) {
    const saida = await optOutTelefone(db, from, "sms");
    if (saida?.contatoSaiu) {
      await emitContactEvent("sms_unsubscribed", contato.id, { phone: from });
    }
  }
}
