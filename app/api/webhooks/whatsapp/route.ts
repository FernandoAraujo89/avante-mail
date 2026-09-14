import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  campaignSends,
  contacts,
  getDb,
  whatsappTemplates,
} from "@/lib/db";
import { emitContactEvent } from "@/lib/events";
import { sendEmail } from "@/lib/ses";
import { errorMessage } from "@/lib/utils";
import {
  isWhatsAppConfigured,
  mapMetaTemplateStatus,
} from "@/lib/whatsapp/client";
import {
  applyConversationMessageStatus,
  recordInboundMessage,
  sendTextInConversation,
} from "@/lib/whatsapp/conversations";
import {
  parseInboundMessage,
  shouldEmitRepliedEvent,
  type WebhookInboundMessage,
} from "@/lib/whatsapp/inbound";
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
 *        recebidas (gravadas na conversa, com o botão tocado e o opt-out
 *        "SAIR"), status de template e qualidade do número. Assinado com
 *        HMAC-SHA256 (X-Hub-Signature-256) do corpo cru com o App Secret —
 *        verificação timing-safe, fail-closed.
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

interface WebhookChange {
  field?: string;
  value?: {
    statuses?: WebhookStatus[];
    messages?: WebhookInboundMessage[];
    /** Perfis de quem escreveu: o nome que a pessoa usa no WhatsApp. */
    contacts?: { wa_id?: string; profile?: { name?: string } }[];
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
              await handleInboundMessage(message, change.value?.contacts ?? []);
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

  const firstError = status.errors?.[0];
  const event = {
    status: status.status,
    timestamp: parseWebhookTimestamp(status.timestamp),
    errorCode: firstError?.code != null ? String(firstError.code) : null,
    errorMessage: firstError?.message ?? firstError?.title ?? null,
  };

  if (!send) {
    // Não é envio de campanha/automação: pode ser resposta da equipe na
    // conversa. Se também não for, é mensagem de fora do sistema.
    await applyConversationMessageStatus(wamid, event);
    return;
  }

  const patch = whatsappStatusPatch(send as CurrentSendState, event);

  if (patch) {
    await db
      .update(campaignSends)
      .set(patch)
      .where(eq(campaignSends.id, send.id));
  }
}

/**
 * Mensagem recebida: grava na conversa, liga ao envio a que responde (o botão
 * tocado vai para o relatório da campanha) e trata o opt-out por palavra.
 */
async function handleInboundMessage(
  raw: WebhookInboundMessage,
  profiles: { wa_id?: string; profile?: { name?: string } }[]
): Promise<void> {
  const message = parseInboundMessage(raw);
  if (!message) return;

  const profileName =
    profiles
      .find((p) => (p.wa_id ?? "").replace(/\D/g, "") === message.waId)
      ?.profile?.name?.trim() || null;

  const record = await recordInboundMessage(message, {
    profileName,
    raw: raw as Record<string, unknown>,
  });
  // Reentrega de um evento já gravado: tudo abaixo já aconteceu uma vez.
  if (!record) return;

  const { contact, send } = record;
  if (!contact || message.isReaction) return;

  if (
    shouldEmitRepliedEvent({
      isButtonReply: message.isButtonReply,
      firstReplyToSend: send?.firstReply ?? false,
      previousInboundAt: record.previousInboundAt,
      at: message.at,
    })
  ) {
    await emitContactEvent("whatsapp_replied", contact.id, {
      campaignId: send?.campaignId ?? null,
      sendId: send?.id ?? null,
      // O botão no payload deixa gatilho e pontuação distinguirem "vou" de
      // "não vou" (a condição casa pelas chaves do payload).
      ...(message.isButtonReply && message.body ? { button: message.body } : {}),
    });
  }

  if (isOptOutMessage(message.body) && contact.whatsappSubscribed) {
    await getDb()
      .update(contacts)
      .set({ whatsappSubscribed: false, whatsappOptOutAt: new Date() })
      .where(eq(contacts.id, contact.id));

    await emitContactEvent("whatsapp_unsubscribed", contact.id);

    // Confirmação em texto livre (grátis, dentro da janela de 24h aberta pela
    // própria mensagem do contato). Best-effort — não bloqueia o opt-out. Vai
    // pela conversa para a equipe ver o que o contato recebeu.
    if (isWhatsAppConfigured()) {
      const { error } = await sendTextInConversation({
        conversationId: record.conversationId,
        to: message.waId,
        text: "Pronto! Você não vai mais receber nossas mensagens por aqui. Se mudar de ideia, é só responder.",
        sentBy: { id: null, name: "Resposta automática (descadastro)" },
      });
      if (error) {
        console.error("[WEBHOOK-WA] Falha ao confirmar opt-out:", error);
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
