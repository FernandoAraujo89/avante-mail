import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { campaignSends, contacts, getDb } from "@/lib/db";
import { emitContactEvent } from "@/lib/events";
import { errorMessage } from "@/lib/utils";
import {
  formParamsToRecord,
  publicWebhookUrl,
  shouldBlockContact,
  smsStatusPatch,
  verifyTwilioSignature,
  type CurrentSmsSendState,
} from "@/lib/sms/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Status callback da Twilio (SMS) — application/x-www-form-urlencoded.
 *
 * Chega um POST por transição de status de cada mensagem (queued → sending →
 * sent → delivered | undelivered | failed), assinado com X-Twilio-Signature
 * sobre a URL pública + params do corpo. A validação usa o SDK oficial com o
 * Auth Token — é o ÚNICO papel do Auth Token no sistema.
 *
 * A resposta é 204 e rápida (a Twilio corta em 15s): o processamento são três
 * queries; se um dia crescer, move-se para a fila — a Twilio não reentrega
 * status callback, então nunca respondemos erro por falha nossa de negócio.
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
    await processStatus(params);
  } catch (error) {
    // Falha nossa não vira retry da Twilio (ela não reentrega status) — loga
    // com o MessageSid para investigação e responde 204 mesmo assim.
    console.error(
      "[WEBHOOK-SMS] Erro ao processar status:",
      JSON.stringify({
        messageSid: params.MessageSid ?? null,
        error: errorMessage(error),
      })
    );
  }

  return new NextResponse(null, { status: 204 });
}

async function processStatus(params: Record<string, string>): Promise<void> {
  const messageSid = params.MessageSid;
  const messageStatus = params.MessageStatus;
  if (!messageSid || !messageStatus) return;

  const errorCode = params.ErrorCode || null;
  const db = getDb();

  const [send] = await db
    .select({
      id: campaignSends.id,
      campaignId: campaignSends.campaignId,
      contactId: campaignSends.contactId,
      status: campaignSends.status,
      sentAt: campaignSends.sentAt,
      deliveredAt: campaignSends.deliveredAt,
    })
    .from(campaignSends)
    .where(eq(campaignSends.providerMessageId, messageSid));

  if (!send) return; // status de mensagem que não é do sistema

  const patch = smsStatusPatch(send as CurrentSmsSendState, {
    status: messageStatus,
    errorCode,
  });

  if (patch) {
    await db
      .update(campaignSends)
      .set(patch)
      .where(eq(campaignSends.id, send.id));
  }

  // Log estruturado do evento: sid + campanha + status. NUNCA o corpo da
  // mensagem nem credencial — log vaza para todo lado.
  console.log(
    "[WEBHOOK-SMS]",
    JSON.stringify({
      messageSid,
      campaignId: send.campaignId,
      status: messageStatus,
      errorCode,
    })
  );

  // 21614 (inválido/fixo) e 21610 (opt-out no provedor): o CONTATO sai do
  // canal — reenviar seria pagar para errar a mesma coisa.
  if (shouldBlockContact(errorCode)) {
    const [contato] = await db
      .select({ id: contacts.id, smsSubscribed: contacts.smsSubscribed })
      .from(contacts)
      .where(eq(contacts.id, send.contactId));

    if (contato?.smsSubscribed) {
      await db
        .update(contacts)
        .set({ smsSubscribed: false, smsOptOutAt: new Date() })
        .where(eq(contacts.id, contato.id));
      await emitContactEvent("sms_unsubscribed", contato.id, {
        campaignId: send.campaignId ?? null,
        sendId: send.id,
        errorCode,
      });
    }
  }
}
