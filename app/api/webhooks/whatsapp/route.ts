import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";

import {
  campaignSends,
  contacts,
  getDb,
  whatsappTemplates,
} from "@/lib/db";
import { phoneToWaId } from "@/lib/phone";
import { sendEmail } from "@/lib/ses";
import { errorMessage } from "@/lib/utils";
import {
  isWhatsAppConfigured,
  mapMetaTemplateStatus,
  sendTextMessage,
} from "@/lib/whatsapp/client";
import {
  isOptOutMessage,
  parseWebhookTimestamp,
  verifySignature,
  whatsappStatusPatch,
  type CurrentSendState,
} from "@/lib/whatsapp/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Webhook da WhatsApp Cloud API (Meta).
 *
 * GET  — handshake de verificação: a Meta chama com hub.verify_token e espera
 *        o hub.challenge de volta em texto puro. Confere WHATSAPP_WEBHOOK_VERIFY_TOKEN.
 * POST — eventos: status de mensagem (sent/delivered/read/failed), mensagens
 *        recebidas (respostas e opt-out "SAIR"), status de template e
 *        qualidade do número. Assinado com HMAC-SHA256 (X-Hub-Signature-256)
 *        do corpo cru com o App Secret — verificação timing-safe, fail-closed.
 *
 * Testável sem a conta Meta: defina WHATSAPP_APP_SECRET e
 * WHATSAPP_WEBHOOK_VERIFY_TOKEN (valores fictícios) no .env.local e rode
 * scripts/test-whatsapp-webhook.ts — ele assina os payloads com o mesmo segredo.
 */

// ─── GET: handshake ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge") ?? "";

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "WHATSAPP_WEBHOOK_VERIFY_TOKEN não configurado." },
      { status: 503 }
    );
  }
  if (mode === "subscribe" && token === expected) {
    // A Meta espera o desafio ecoado como texto puro.
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return NextResponse.json({ error: "Verificação falhou." }, { status: 403 });
}

// ─── POST: eventos ───────────────────────────────────────────────────

interface WebhookStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}

interface WebhookMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
}

interface WebhookChange {
  field?: string;
  value?: {
    statuses?: WebhookStatus[];
    messages?: WebhookMessage[];
    // message_template_status_update
    message_template_id?: number | string;
    message_template_name?: string;
    message_template_language?: string;
    event?: string;
    reason?: string;
    // phone_number_quality_update
    display_phone_number?: string;
    current_limit?: string;
  };
}

interface WebhookPayload {
  entry?: { changes?: WebhookChange[] }[];
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256");
    const check = verifySignature(
      rawBody,
      signature,
      process.env.WHATSAPP_APP_SECRET
    );
    if (!check.ok) {
      if (!check.configured) {
        return NextResponse.json(
          { error: "WHATSAPP_APP_SECRET não configurado." },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: "Assinatura inválida." },
        { status: 401 }
      );
    }

    const payload = JSON.parse(rawBody) as WebhookPayload;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        try {
          if (change.field === "messages") {
            for (const status of change.value?.statuses ?? []) {
              await handleStatus(status);
            }
            for (const message of change.value?.messages ?? []) {
              await handleInboundMessage(message);
            }
          } else if (change.field === "message_template_status_update") {
            await handleTemplateStatus(change);
          } else if (change.field === "phone_number_quality_update") {
            await handleQualityUpdate(change);
          }
        } catch (error) {
          // Um evento com problema não derruba o lote — a Meta reentrega se
          // respondermos !=200, então logamos e seguimos.
          console.error(
            "[WEBHOOK-WA] Erro ao processar evento:",
            errorMessage(error)
          );
        }
      }
    }

    // 200 rápido: a Meta reentrega em qualquer resposta != 2xx.
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

// ─── Handlers ────────────────────────────────────────────────────────

/** Status de mensagem: casa o wamid e aplica a transição monotônica. */
async function handleStatus(status: WebhookStatus): Promise<void> {
  const wamid = status.id;
  if (!wamid || !status.status) return;
  const db = getDb();

  const [send] = await db
    .select({
      id: campaignSends.id,
      status: campaignSends.status,
      sentAt: campaignSends.sentAt,
      deliveredAt: campaignSends.deliveredAt,
      readAt: campaignSends.readAt,
    })
    .from(campaignSends)
    .where(eq(campaignSends.providerMessageId, wamid));

  if (!send) return; // status de uma mensagem que não é do sistema

  const firstError = status.errors?.[0];
  const patch = whatsappStatusPatch(send as CurrentSendState, {
    status: status.status,
    timestamp: parseWebhookTimestamp(status.timestamp),
    errorCode: firstError?.code != null ? String(firstError.code) : null,
    errorMessage: firstError?.message ?? firstError?.title ?? null,
  });

  if (patch) {
    await db
      .update(campaignSends)
      .set(patch)
      .where(eq(campaignSends.id, send.id));
  }
}

/** Extrai o texto de uma mensagem recebida, seja qual for o tipo. */
function inboundText(message: WebhookMessage): string | null {
  if (message.type === "text") return message.text?.body ?? null;
  if (message.type === "button") return message.button?.text ?? null;
  if (message.type === "interactive") {
    return (
      message.interactive?.button_reply?.title ??
      message.interactive?.list_reply?.title ??
      null
    );
  }
  return null;
}

/** Mensagem recebida: registra a resposta e trata o opt-out por palavra-chave. */
async function handleInboundMessage(message: WebhookMessage): Promise<void> {
  if (!message.from) return;
  const db = getDb();
  const phone = `+${phoneToWaId(message.from)}`;

  const [contact] = await db
    .select({
      id: contacts.id,
      whatsappSubscribed: contacts.whatsappSubscribed,
    })
    .from(contacts)
    .where(eq(contacts.phone, phone));

  if (!contact) return; // resposta de um número que não está na base

  // Marca a resposta no envio mais recente deste contato (para o relatório).
  const [lastSend] = await db
    .select({ id: campaignSends.id })
    .from(campaignSends)
    .where(
      and(
        eq(campaignSends.contactId, contact.id),
        isNull(campaignSends.repliedAt)
      )
    )
    .orderBy(desc(campaignSends.sentAt))
    .limit(1);

  if (lastSend) {
    await db
      .update(campaignSends)
      .set({ repliedAt: new Date() })
      .where(eq(campaignSends.id, lastSend.id));
  }

  if (isOptOutMessage(inboundText(message)) && contact.whatsappSubscribed) {
    await db
      .update(contacts)
      .set({ whatsappSubscribed: false, whatsappOptOutAt: new Date() })
      .where(eq(contacts.id, contact.id));

    // Confirmação em texto livre (grátis, dentro da janela de 24h aberta pela
    // própria mensagem do contato). Best-effort — não bloqueia o opt-out.
    if (isWhatsAppConfigured()) {
      try {
        await sendTextMessage({
          to: phoneToWaId(message.from),
          text: "Pronto! Você não vai mais receber nossas mensagens por aqui. Se mudar de ideia, é só responder.",
        });
      } catch (error) {
        console.error(
          "[WEBHOOK-WA] Falha ao confirmar opt-out:",
          errorMessage(error)
        );
      }
    }
  }
}

/** Atualização de status de template (aprovado/rejeitado/pausado). */
async function handleTemplateStatus(change: WebhookChange): Promise<void> {
  const value = change.value;
  if (!value?.event) return;
  const db = getDb();
  const status = mapMetaTemplateStatus(value.event);

  const metaId =
    value.message_template_id != null
      ? String(value.message_template_id)
      : null;

  // O nome é a chave única local e vem sempre no evento — casa por ele e
  // aproveita para preencher/atualizar o metaTemplateId. Sem nome (não
  // deveria acontecer), cai no id da Meta.
  const target = value.message_template_name
    ? eq(whatsappTemplates.name, value.message_template_name)
    : metaId
      ? eq(whatsappTemplates.metaTemplateId, metaId)
      : null;
  if (!target) return;

  await db
    .update(whatsappTemplates)
    .set({
      status,
      rejectionReason:
        value.reason && value.reason !== "NONE" ? value.reason : null,
      ...(metaId ? { metaTemplateId: metaId } : {}),
      updatedAt: new Date(),
    })
    .where(target);
}

/** Mudança de qualidade/limite do número — alerta o administrador. */
async function handleQualityUpdate(change: WebhookChange): Promise<void> {
  const value = change.value;
  const event = value?.event ?? "desconhecido";
  const limit = value?.current_limit ?? "";
  const line = `[WEBHOOK-WA] Qualidade do número: evento=${event} limite=${limit}`;
  console.warn(line);

  // Alerta por e-mail (best-effort; SES pode estar em sandbox).
  const to = process.env.WHATSAPP_ALERT_EMAIL || process.env.SES_FROM_EMAIL;
  if (!to || !process.env.SES_FROM_EMAIL) return;
  try {
    await sendEmail({
      to,
      subject: `Alerta WhatsApp: qualidade do número (${event})`,
      html: `<p>A Meta reportou uma mudança na qualidade/limite do número de WhatsApp.</p>
             <ul><li>Evento: <b>${event}</b></li><li>Limite atual: <b>${limit || "—"}</b></li></ul>
             <p>Verifique o Gerenciador do WhatsApp Business.</p>`,
    });
  } catch (error) {
    console.error(
      "[WEBHOOK-WA] Falha ao enviar alerta de qualidade:",
      errorMessage(error)
    );
  }
}
