import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { modeloDoPassoDeWhatsApp } from "@/lib/automations/envios";
import {
  automationRuns,
  automations,
  campaigns,
  campaignSends,
  contacts,
  getDb,
  whatsappConversations,
  whatsappMessages,
  whatsappTemplates,
  type WhatsAppMessage,
  type WhatsAppTemplate,
} from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { getSetting } from "@/lib/settings";
import { errorMessage } from "@/lib/utils";

import {
  AUTO_REPLY_INTERVAL_MS,
  AUTO_REPLY_SENDER_NAME,
  AUTO_REPLY_SETTING_KEY,
  autoReplyDecision,
  buildAutoReply,
  readAutoReplySettings,
  type AutoReplySkipReason,
} from "./auto-reply";
import {
  isWhatsAppConfigured,
  sendCtaUrlMessage,
  sendTextMessage,
  WhatsAppApiError,
} from "./client";
import {
  attributionStrategy,
  messagePreview,
  phoneCandidatesFromWaId,
  REPLY_ATTRIBUTION_DAYS,
  serviceWindow,
  type ParsedInboundMessage,
} from "./inbound";
import type {
  ConversationSummary,
  ConversationThread,
  ThreadItem,
  ThreadMessage,
  ThreadTemplate,
} from "./thread-types";
import {
  fillVariables,
  isMediaHeader,
  type WhatsAppVariableMap,
} from "./types";
import { resolveVariables } from "./variables";
import {
  isOptOutMessage,
  whatsappStatusPatch,
  type StatusEvent,
} from "./webhook";

// A caixa de conversas no banco: gravar o que chega, mandar o que a equipe
// responde e montar a conversa para a tela. A interpretação da mensagem (tipo,
// janela, a que envio responde) é pura e mora em lib/whatsapp/inbound.ts.

type ContactRef = { id: string; phone: string | null; whatsappSubscribed: boolean };

/** O contato dono do número, aceitando as duas formas do celular brasileiro. */
async function findContactByWaId(waId: string): Promise<ContactRef | null> {
  const candidates = phoneCandidatesFromWaId(waId);
  if (candidates.length === 0) return null;
  const rows = await getDb()
    .select({
      id: contacts.id,
      phone: contacts.phone,
      whatsappSubscribed: contacts.whatsappSubscribed,
    })
    .from(contacts)
    .where(inArray(contacts.phone, candidates));
  // A forma exata vem primeiro: se as duas estiverem cadastradas (contato
  // duplicado), vale a que o WhatsApp informou.
  for (const phone of candidates) {
    const hit = rows.find((r) => r.phone === phone);
    if (hit) return hit;
  }
  return null;
}

type SendRef = {
  id: string;
  contactId: string;
  campaignId: string | null;
  repliedAt: Date | null;
};

const SEND_REF = {
  id: campaignSends.id,
  contactId: campaignSends.contactId,
  campaignId: campaignSends.campaignId,
  repliedAt: campaignSends.repliedAt,
};

export interface InboundRecord {
  conversationId: string;
  contact: { id: string; whatsappSubscribed: boolean } | null;
  send: { id: string; campaignId: string | null; firstReply: boolean } | null;
  /** A última mensagem do contato ANTES desta — decide se vira evento. */
  previousInboundAt: Date | null;
}

/**
 * Grava a mensagem recebida na conversa do número e a liga ao envio a que
 * responde. Devolve null quando a mensagem já estava gravada: a Meta reentrega
 * eventos, e a reentrega não pode contar a resposta de novo.
 */
export async function recordInboundMessage(
  message: ParsedInboundMessage,
  extra: { profileName: string | null; raw: Record<string, unknown> }
): Promise<InboundRecord | null> {
  const db = getDb();
  const strategy = attributionStrategy(message);

  // O envio citado identifica o contato com certeza, qualquer que seja o
  // formato do número — é o caminho de todo toque de botão.
  let send: SendRef | null = null;
  if (strategy === "context" && message.contextWamid) {
    [send = null] = await db
      .select(SEND_REF)
      .from(campaignSends)
      .where(
        and(
          eq(campaignSends.providerMessageId, message.contextWamid),
          eq(campaignSends.channel, "whatsapp")
        )
      )
      .limit(1);
  }

  let contact: ContactRef | null = null;
  if (send) {
    [contact = null] = await db
      .select({
        id: contacts.id,
        phone: contacts.phone,
        whatsappSubscribed: contacts.whatsappSubscribed,
      })
      .from(contacts)
      .where(eq(contacts.id, send.contactId));
  }
  contact ??= await findContactByWaId(message.waId);

  if (strategy === "recent" && contact) {
    const since = new Date(
      message.at.getTime() - REPLY_ATTRIBUTION_DAYS * 86_400_000
    );
    // O horário da mensagem vem da Meta, em segundos; o do envio, do nosso
    // relógio, em milissegundos. A folga de um minuto absorve essa diferença
    // sem deixar a mensagem responder a um envio feito depois dela.
    const until = new Date(message.at.getTime() + 60_000);
    [send = null] = await db
      .select(SEND_REF)
      .from(campaignSends)
      .where(
        and(
          eq(campaignSends.contactId, contact.id),
          eq(campaignSends.channel, "whatsapp"),
          // Mensagem que não chegou não recebe resposta.
          ne(campaignSends.status, "failed"),
          isNotNull(campaignSends.sentAt),
          gte(campaignSends.sentAt, since),
          lte(campaignSends.sentAt, until)
        )
      )
      .orderBy(desc(campaignSends.sentAt))
      .limit(1);
  }

  const conversationPhone = contact?.phone ?? `+${message.waId}`;
  const lookupPhones = [
    ...new Set([conversationPhone, ...phoneCandidatesFromWaId(message.waId)]),
  ];
  const preview = messagePreview(message);
  const at = message.at;

  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(whatsappConversations)
      .where(inArray(whatsappConversations.phone, lookupPhones))
      .for("update");
    let conversation =
      existing.find((c) => c.phone === conversationPhone) ?? existing[0];

    if (conversation) {
      await tx
        .update(whatsappConversations)
        .set({
          waId: message.waId,
          contactId: contact?.id ?? null,
          profileName: extra.profileName ?? conversation.profileName,
        })
        .where(eq(whatsappConversations.id, conversation.id));
    } else {
      [conversation] = await tx
        .insert(whatsappConversations)
        .values({
          phone: conversationPhone,
          waId: message.waId,
          contactId: contact?.id ?? null,
          profileName: extra.profileName,
          lastMessageAt: at,
        })
        // Duas entregas simultâneas do primeiro contato de um número.
        .onConflictDoUpdate({
          target: whatsappConversations.phone,
          set: { waId: message.waId },
        })
        .returning();
    }

    const [inserted] = await tx
      .insert(whatsappMessages)
      .values({
        conversationId: conversation.id,
        direction: "inbound",
        wamid: message.wamid,
        type: message.type,
        body: message.body,
        buttonPayload: message.buttonPayload,
        mediaId: message.media?.id ?? null,
        mediaMimeType: message.media?.mimeType ?? null,
        mediaFilename: message.media?.filename ?? null,
        contextWamid: message.contextWamid,
        campaignSendId: send?.id ?? null,
        raw: extra.raw,
        createdAt: at,
      })
      .onConflictDoNothing({ target: whatsappMessages.wamid })
      .returning({ id: whatsappMessages.id });
    if (!inserted) return null;

    // O resumo só troca se esta for mesmo a mais recente: a Meta não garante a
    // ordem, e uma mensagem atrasada não pode virar a "última" da lista.
    const isNewest = sql`${at}::timestamptz >= ${whatsappConversations.lastMessageAt}`;
    await tx
      .update(whatsappConversations)
      .set({
        lastMessageAt: sql`greatest(${whatsappConversations.lastMessageAt}, ${at}::timestamptz)`,
        lastMessagePreview: sql`case when ${isNewest} then ${preview} else ${whatsappConversations.lastMessagePreview} end`,
        lastMessageDirection: sql`case when ${isNewest} then 'inbound' else ${whatsappConversations.lastMessageDirection} end`,
        // A reação não abre a janela de atendimento nem pede leitura.
        ...(message.isReaction
          ? {}
          : {
              lastInboundAt: sql`greatest(${whatsappConversations.lastInboundAt}, ${at}::timestamptz)`,
              unreadCount: sql`${whatsappConversations.unreadCount} + 1`,
            }),
      })
      .where(eq(whatsappConversations.id, conversation.id));

    if (send) {
      const buttonText = message.isButtonReply ? message.body : null;
      await tx
        .update(campaignSends)
        .set({
          repliedAt: sql`coalesce(${campaignSends.repliedAt}, ${at}::timestamptz)`,
          ...(buttonText
            ? {
                // Vale o último toque — pela hora do toque, não pela ordem de
                // chegada do evento.
                replyButton: sql`case when ${campaignSends.replyButtonAt} is null or ${campaignSends.replyButtonAt} <= ${at}::timestamptz then ${buttonText} else ${campaignSends.replyButton} end`,
                replyButtonAt: sql`greatest(${campaignSends.replyButtonAt}, ${at}::timestamptz)`,
              }
            : {}),
        })
        .where(eq(campaignSends.id, send.id));
    }

    return {
      conversationId: conversation.id,
      contact: contact
        ? { id: contact.id, whatsappSubscribed: contact.whatsappSubscribed }
        : null,
      send: send
        ? {
            id: send.id,
            campaignId: send.campaignId,
            firstReply: send.repliedAt === null,
          }
        : null,
      previousInboundAt: conversation.lastInboundAt,
    };
  });
}

/**
 * Manda um texto livre na conversa e o registra — com o erro, quando a Meta
 * recusa, para a falha aparecer no balão em vez de sumir.
 * Quem chama confere a janela de 24h antes.
 */
export async function sendTextInConversation(args: {
  conversationId: string;
  to: string;
  text: string;
  sentBy: { id: string | null; name: string };
  /**
   * Mensagem do sistema (confirmação de descadastro): não troca o resumo da
   * lista de conversas — ali importa o que o contato disse por último.
   */
  automatic?: boolean;
}): Promise<{ message: WhatsAppMessage; error: string | null }> {
  const db = getDb();
  const now = new Date();

  const [pending] = await db
    .insert(whatsappMessages)
    .values({
      conversationId: args.conversationId,
      direction: "outbound",
      type: "text",
      body: args.text,
      status: "pending",
      sentByUserId: args.sentBy.id,
      sentByName: args.sentBy.name,
      createdAt: now,
    })
    .returning();

  if (!args.automatic) {
    await db
      .update(whatsappConversations)
      .set({
        lastMessageAt: sql`greatest(${whatsappConversations.lastMessageAt}, ${now}::timestamptz)`,
        lastMessagePreview: messagePreview({ type: "text", body: args.text }),
        lastMessageDirection: "outbound",
      })
      .where(eq(whatsappConversations.id, args.conversationId));
  }

  try {
    const { wamid } = await sendTextMessage({
      to: args.to,
      text: args.text,
      previewUrl: /https?:\/\//i.test(args.text),
    });
    const [sent] = await db
      .update(whatsappMessages)
      .set({ wamid, status: "sent", sentAt: new Date() })
      .where(eq(whatsappMessages.id, pending.id))
      .returning();
    return { message: sent ?? pending, error: null };
  } catch (error) {
    const code =
      error instanceof WhatsAppApiError && error.code !== null
        ? String(error.code)
        : null;
    const [failed] = await db
      .update(whatsappMessages)
      .set({ status: "failed", errorCode: code, errorMessage: errorMessage(error) })
      .where(eq(whatsappMessages.id, pending.id))
      .returning();
    return { message: failed ?? pending, error: errorMessage(error) };
  }
}

export type AutoReplyOutcome =
  | "sent"
  | "failed"
  | "not_configured"
  | AutoReplySkipReason;

/**
 * Resposta automática ao que o contato acabou de mandar ("este número não é
 * canal de atendimento", com o botão para o Sucesso do Cliente). As regras de
 * quando responder são puras e testadas em lib/whatsapp/auto-reply.ts; aqui
 * ficam a leitura do banco, a reserva e o envio.
 *
 * Não lança: resposta automática que falha não pode fazer o webhook falhar.
 * A falha fica gravada na conversa, onde a equipe vê.
 */
export async function sendAutoReplyIfNeeded(args: {
  conversationId: string;
  /** wa_id de quem escreveu. */
  to: string;
  message: ParsedInboundMessage;
}): Promise<AutoReplyOutcome> {
  if (!isWhatsAppConfigured()) return "not_configured";
  const db = getDb();
  const now = new Date();

  const settings = readAutoReplySettings(await getSetting(AUTO_REPLY_SETTING_KEY));
  const [conversation] = await db
    .select({ autoRepliedAt: whatsappConversations.autoRepliedAt })
    .from(whatsappConversations)
    .where(eq(whatsappConversations.id, args.conversationId));
  // Resposta de gente da equipe (com usuário) — a automática não conta.
  const [team] = await db
    .select({ at: max(whatsappMessages.createdAt) })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.conversationId, args.conversationId),
        eq(whatsappMessages.direction, "outbound"),
        isNotNull(whatsappMessages.sentByUserId)
      )
    );

  const decision = autoReplyDecision({
    settings,
    message: args.message,
    isOptOut: isOptOutMessage(args.message.body),
    lastTeamReplyAt: team?.at ?? null,
    lastAutoReplyAt: conversation?.autoRepliedAt ?? null,
    now,
  });
  if (!decision.send) return decision.reason;

  // Reserva condicional: com duas mensagens do mesmo contato processadas ao
  // mesmo tempo, só uma passa daqui.
  const claimed = await db
    .update(whatsappConversations)
    .set({ autoRepliedAt: now })
    .where(
      and(
        eq(whatsappConversations.id, args.conversationId),
        or(
          isNull(whatsappConversations.autoRepliedAt),
          lte(
            whatsappConversations.autoRepliedAt,
            new Date(now.getTime() - AUTO_REPLY_INTERVAL_MS)
          )
        )
      )
    )
    .returning({ id: whatsappConversations.id });
  if (claimed.length === 0) return "recent";

  const content = buildAutoReply(settings, formatPhone);
  let outcome: {
    type: string;
    body: string;
    raw: Record<string, unknown> | null;
    wamid: string | null;
    error: unknown;
  } = {
    type: "interactive",
    body: content.body,
    // Guardado para a conversa desenhar o botão como o contato o viu.
    raw: { cta: { text: content.buttonText, url: content.url } },
    wamid: null,
    error: null,
  };

  try {
    outcome.wamid = (
      await sendCtaUrlMessage({
        to: args.to,
        body: content.body,
        buttonText: content.buttonText,
        url: content.url,
      })
    ).wamid;
  } catch (error) {
    outcome.error = error;
    // A Meta recusou a mensagem com botão (parâmetro, versão do aplicativo):
    // o aviso vai em texto, com o link no fim — o contato não fica sem saber
    // para onde ir. Falha de rede não tem segunda tentativa aqui.
    if (error instanceof WhatsAppApiError) {
      try {
        const { wamid } = await sendTextMessage({
          to: args.to,
          text: content.fallbackText,
          previewUrl: true,
        });
        outcome = { type: "text", body: content.fallbackText, raw: null, wamid, error: null };
      } catch (fallbackError) {
        outcome.error = fallbackError;
      }
    }
  }

  try {
    const failed = outcome.error !== null;
    await db.insert(whatsappMessages).values({
      conversationId: args.conversationId,
      direction: "outbound",
      type: outcome.type,
      body: outcome.body,
      raw: outcome.raw,
      wamid: outcome.wamid,
      status: failed ? "failed" : "sent",
      sentAt: failed ? null : new Date(),
      errorCode:
        outcome.error instanceof WhatsAppApiError && outcome.error.code !== null
          ? String(outcome.error.code)
          : null,
      errorMessage: failed ? errorMessage(outcome.error) : null,
      sentByUserId: null,
      sentByName: AUTO_REPLY_SENDER_NAME,
      createdAt: now,
    });
    return failed ? "failed" : "sent";
  } catch (error) {
    console.error(
      "[WHATSAPP] Resposta automática sem registro na conversa:",
      errorMessage(error)
    );
    return outcome.error !== null ? "failed" : "sent";
  }
}

/**
 * Status (entregue/lida/falhou) de uma resposta da equipe. Mesma regra
 * monotônica dos envios de campanha. Devolve false se o wamid não é de
 * mensagem da conversa.
 */
export async function applyConversationMessageStatus(
  wamid: string,
  event: StatusEvent
): Promise<boolean> {
  const db = getDb();
  const [message] = await db
    .select({
      id: whatsappMessages.id,
      status: whatsappMessages.status,
      sentAt: whatsappMessages.sentAt,
      deliveredAt: whatsappMessages.deliveredAt,
      readAt: whatsappMessages.readAt,
    })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.wamid, wamid),
        eq(whatsappMessages.direction, "outbound")
      )
    );
  if (!message) return false;

  const patch = whatsappStatusPatch(
    { ...message, status: message.status ?? "pending" },
    event
  );
  if (patch) {
    await db
      .update(whatsappMessages)
      .set(patch)
      .where(eq(whatsappMessages.id, message.id));
  }
  return true;
}

/**
 * Zera as não lidas. Devolve o wamid da última mensagem do contato quando
 * havia algo por ler — é ela que recebe a confirmação de leitura na Meta.
 */
export async function markConversationRead(
  conversationId: string
): Promise<{ lastInboundWamid: string | null }> {
  const db = getDb();
  const updated = await db
    .update(whatsappConversations)
    .set({ unreadCount: 0 })
    .where(
      and(
        eq(whatsappConversations.id, conversationId),
        gt(whatsappConversations.unreadCount, 0)
      )
    )
    .returning({ id: whatsappConversations.id });
  if (updated.length === 0) return { lastInboundWamid: null };

  const [last] = await db
    .select({ wamid: whatsappMessages.wamid })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.conversationId, conversationId),
        eq(whatsappMessages.direction, "inbound"),
        ne(whatsappMessages.type, "reaction")
      )
    )
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(1);
  return { lastInboundWamid: last?.wamid ?? null };
}

/** Conversas com mensagem por ler — o número ao lado de "Conversas" no menu. */
export async function countUnreadConversations(): Promise<number> {
  const [row] = await getDb()
    .select({ total: count() })
    .from(whatsappConversations)
    .where(gt(whatsappConversations.unreadCount, 0));
  return row?.total ?? 0;
}

function displayName(row: {
  contactName: string | null;
  profileName: string | null;
  phone: string;
}): string {
  return row.contactName?.trim() || row.profileName?.trim() || formatPhone(row.phone);
}

const SUMMARY_FIELDS = {
  id: whatsappConversations.id,
  phone: whatsappConversations.phone,
  contactId: whatsappConversations.contactId,
  profileName: whatsappConversations.profileName,
  lastMessageAt: whatsappConversations.lastMessageAt,
  lastInboundAt: whatsappConversations.lastInboundAt,
  lastMessagePreview: whatsappConversations.lastMessagePreview,
  lastMessageDirection: whatsappConversations.lastMessageDirection,
  unreadCount: whatsappConversations.unreadCount,
  contactName: contacts.name,
  company: contacts.company,
  whatsappSubscribed: contacts.whatsappSubscribed,
  whatsappOptOutAt: contacts.whatsappOptOutAt,
};

type SummaryRow = {
  id: string;
  phone: string;
  contactId: string | null;
  profileName: string | null;
  lastMessageAt: Date;
  lastInboundAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  unreadCount: number;
  contactName: string | null;
  company: string | null;
};

function toSummary(row: SummaryRow): ConversationSummary {
  return {
    id: row.id,
    phone: row.phone,
    contactId: row.contactId,
    displayName: displayName(row),
    company: row.company,
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
    lastMessagePreview: row.lastMessagePreview,
    lastMessageDirection: row.lastMessageDirection,
    unreadCount: row.unreadCount,
  };
}

/** Teto da lista: a base inteira tem ~1.500 contatos; a busca alcança o resto. */
export const CONVERSATION_LIST_LIMIT = 200;

export async function listConversations(opts: {
  search?: string;
  unreadOnly?: boolean;
}): Promise<ConversationSummary[]> {
  const conditions: SQL[] = [];
  if (opts.unreadOnly) conditions.push(gt(whatsappConversations.unreadCount, 0));
  const search = opts.search?.trim();
  if (search) {
    const term = `%${search}%`;
    const digits = search.replace(/\D/g, "");
    const match = or(
      ilike(contacts.name, term),
      ilike(contacts.company, term),
      ilike(whatsappConversations.profileName, term),
      // Telefone digitado com máscara: compara só os dígitos.
      ...(digits.length >= 3
        ? [ilike(whatsappConversations.phone, `%${digits}%`)]
        : [])
    );
    if (match) conditions.push(match);
  }

  const rows = await getDb()
    .select(SUMMARY_FIELDS)
    .from(whatsappConversations)
    .leftJoin(contacts, eq(contacts.id, whatsappConversations.contactId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(whatsappConversations.lastMessageAt))
    .limit(CONVERSATION_LIST_LIMIT);

  return rows.map(toSummary);
}

/** A conversa mais recente de cada contato (para os atalhos do relatório e da ficha). */
export async function conversationIdsByContact(
  contactIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (contactIds.length === 0) return map;
  const rows = await getDb()
    .select({
      id: whatsappConversations.id,
      contactId: whatsappConversations.contactId,
    })
    .from(whatsappConversations)
    .where(inArray(whatsappConversations.contactId, contactIds))
    .orderBy(desc(whatsappConversations.lastMessageAt));
  for (const row of rows) {
    if (row.contactId && !map.has(row.contactId)) map.set(row.contactId, row.id);
  }
  return map;
}

/** O botão de link de uma mensagem nossa (a resposta automática), se tiver. */
function ctaOf(message: WhatsAppMessage): { text: string; url: string } | null {
  if (message.direction !== "outbound") return null;
  const cta = message.raw?.cta as { text?: unknown; url?: unknown } | undefined;
  return typeof cta?.text === "string" && typeof cta?.url === "string"
    ? { text: cta.text, url: cta.url }
    : null;
}

/** Quantas mensagens a conversa carrega de uma vez (as mais recentes). */
const THREAD_MESSAGE_LIMIT = 500;
/** Modelos de campanha/automação mostrados na conversa (os mais recentes). */
const THREAD_TEMPLATE_LIMIT = 50;

function templateBubble(
  template: WhatsAppTemplate,
  variables: WhatsAppVariableMap | null,
  contact: { name: string; company: string | null }
): Pick<
  ThreadTemplate,
  "templateName" | "headerText" | "headerMedia" | "bodyText" | "footerText" | "buttons"
> {
  const values = resolveVariables({
    bodyText: template.bodyText,
    variables,
    examples: template.variableExamples,
    contact,
  });
  return {
    templateName: template.name,
    headerText: template.headerType === "text" ? template.headerText : null,
    headerMedia:
      isMediaHeader(template.headerType) && template.headerMediaUrl
        ? {
            kind: template.headerType,
            url: template.headerMediaUrl,
            filename: template.headerMediaFilename,
          }
        : null,
    bodyText: fillVariables(template.bodyText, values),
    footerText: template.footerText,
    buttons: (template.buttons ?? []).map((b) => b.text),
  };
}

export async function loadConversationThread(
  conversationId: string
): Promise<ConversationThread | null> {
  const db = getDb();
  const [row] = await db
    .select(SUMMARY_FIELDS)
    .from(whatsappConversations)
    .leftJoin(contacts, eq(contacts.id, whatsappConversations.contactId))
    .where(eq(whatsappConversations.id, conversationId));
  if (!row) return null;

  const messages = (
    await db
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.conversationId, conversationId))
      .orderBy(desc(whatsappMessages.createdAt))
      .limit(THREAD_MESSAGE_LIMIT)
  ).reverse();

  const templateItems: ThreadTemplate[] = [];
  // O wamid de cada modelo, só para achar o texto citado — não vai para a tela.
  const templateWamids = new Map<string, string>();
  if (row.contactId) {
    const sends = await db
      .select({
        id: campaignSends.id,
        status: campaignSends.status,
        errorCode: campaignSends.errorCode,
        errorMessage: campaignSends.errorMessage,
        sentAt: campaignSends.sentAt,
        wamid: campaignSends.providerMessageId,
        replyButton: campaignSends.replyButton,
        automationStepId: campaignSends.automationStepId,
        campaignId: campaigns.id,
        campaignName: campaigns.name,
        campaignTemplateId: campaigns.whatsappTemplateId,
        campaignVariables: campaigns.whatsappVariables,
        automationId: automations.id,
        automationName: automations.name,
      })
      .from(campaignSends)
      .leftJoin(campaigns, eq(campaigns.id, campaignSends.campaignId))
      .leftJoin(automationRuns, eq(automationRuns.id, campaignSends.automationRunId))
      .leftJoin(automations, eq(automations.id, automationRuns.automationId))
      .where(
        and(
          eq(campaignSends.contactId, row.contactId),
          eq(campaignSends.channel, "whatsapp"),
          isNotNull(campaignSends.sentAt)
        )
      )
      .orderBy(desc(campaignSends.sentAt))
      .limit(THREAD_TEMPLATE_LIMIT);

    // Modelo de cada envio: o da campanha, ou o do passo da automação.
    const stepTemplates = new Map<
      string,
      { template: WhatsAppTemplate; variables: WhatsAppVariableMap | null } | null
    >();
    for (const send of sends) {
      if (send.campaignId || !send.automationStepId) continue;
      if (stepTemplates.has(send.automationStepId)) continue;
      try {
        stepTemplates.set(
          send.automationStepId,
          await modeloDoPassoDeWhatsApp(send.automationStepId)
        );
      } catch {
        // Passo apagado: a conversa mostra o envio sem o texto.
        stepTemplates.set(send.automationStepId, null);
      }
    }
    const campaignTemplateIds = [
      ...new Set(sends.map((s) => s.campaignTemplateId).filter((id): id is string => Boolean(id))),
    ];
    const campaignTemplates = new Map(
      campaignTemplateIds.length > 0
        ? (
            await db
              .select()
              .from(whatsappTemplates)
              .where(inArray(whatsappTemplates.id, campaignTemplateIds))
          ).map((t) => [t.id, t])
        : []
    );

    const contactForVariables = {
      name: row.contactName ?? "",
      company: row.company,
    };
    for (const send of sends) {
      const fromStep = send.automationStepId
        ? stepTemplates.get(send.automationStepId)
        : null;
      const template = send.campaignTemplateId
        ? campaignTemplates.get(send.campaignTemplateId)
        : fromStep?.template;
      const variables = send.campaignId
        ? send.campaignVariables
        : (fromStep?.variables ?? null);

      if (send.wamid) templateWamids.set(send.id, send.wamid);
      templateItems.push({
        kind: "template",
        id: send.id,
        origin: send.campaignId
          ? { type: "campaign", id: send.campaignId, name: send.campaignName ?? "" }
          : send.automationId
            ? { type: "automation", id: send.automationId, name: send.automationName ?? "" }
            : null,
        ...(template
          ? templateBubble(template, variables, contactForVariables)
          : {
              templateName: null,
              headerText: null,
              headerMedia: null,
              bodyText: "Modelo que não existe mais no sistema.",
              footerText: null,
              buttons: [],
            }),
        status: send.status,
        errorCode: send.errorCode,
        errorMessage: send.errorMessage,
        at: send.sentAt!.toISOString(),
        replyButton: send.replyButton,
      });
    }
  }

  // Texto citado: a mensagem ou o modelo a que o contato respondeu.
  const textByWamid = new Map<string, string>();
  for (const m of messages) {
    if (m.wamid) textByWamid.set(m.wamid, messagePreview(m));
  }
  for (const t of templateItems) {
    const wamid = templateWamids.get(t.id);
    if (wamid) textByWamid.set(wamid, t.bodyText);
  }

  const messageItems: ThreadMessage[] = messages.map((m) => ({
    kind: "message",
    id: m.id,
    direction: m.direction,
    type: m.type,
    body: m.body,
    hasMedia: Boolean(m.mediaId),
    mediaMimeType: m.mediaMimeType,
    mediaFilename: m.mediaFilename,
    status: m.status,
    errorCode: m.errorCode,
    errorMessage: m.errorMessage,
    sentByName: m.sentByName,
    cta: ctaOf(m),
    at: m.createdAt.toISOString(),
    // O toque de botão já diz a que respondeu pelo próprio balão do modelo.
    quoted:
      m.contextWamid && m.type !== "button" && m.type !== "reaction"
        ? (textByWamid.get(m.contextWamid) ?? null)
        : null,
  }));

  const items: ThreadItem[] = [...messageItems, ...templateItems].sort((a, b) =>
    a.at.localeCompare(b.at)
  );

  const window = serviceWindow(row.lastInboundAt);
  return {
    conversation: {
      ...toSummary(row),
      profileName: row.profileName,
      optedOut: row.contactId !== null && row.whatsappOptOutAt !== null && !row.whatsappSubscribed,
    },
    items,
    window: { open: window.open, closesAt: window.closesAt?.toISOString() ?? null },
    canSend: isWhatsAppConfigured(),
  };
}
