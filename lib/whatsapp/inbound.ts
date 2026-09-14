import { parseWebhookTimestamp } from "./timestamp";

// Mensagem recebida pelo webhook da Cloud API — lógica pura, sem I/O, como o
// lib/whatsapp/webhook.ts. Quem grava no banco é lib/whatsapp/conversations.ts.
// Também é importado pela caixa de conversas no navegador (resumo e janela de
// 24h): nada de módulo do Node aqui.

interface WebhookMedia {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
}

/** O pedaço de `value.messages[]` que o sistema lê. */
export interface WebhookInboundMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  /** Presente quando a mensagem responde a outra (citação ou toque de botão). */
  context?: { from?: string; id?: string };
  text?: { body?: string };
  /** Toque num botão de resposta rápida de MODELO. */
  button?: { text?: string; payload?: string };
  /** Toque em mensagem interativa (não enviamos, mas o formato existe). */
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  image?: WebhookMedia;
  audio?: WebhookMedia;
  video?: WebhookMedia;
  document?: WebhookMedia;
  sticker?: WebhookMedia;
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  contacts?: {
    name?: { formatted_name?: string };
    phones?: { phone?: string }[];
  }[];
  reaction?: { message_id?: string; emoji?: string };
}

const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

function isMediaType(type: string): type is MediaType {
  return (MEDIA_TYPES as readonly string[]).includes(type);
}

export interface ParsedInboundMessage {
  wamid: string;
  /** Número de quem escreveu, como o WhatsApp o conhece (só dígitos). */
  waId: string;
  type: string;
  body: string | null;
  buttonPayload: string | null;
  /** Tocou um botão — é a resposta que o relatório da campanha apura. */
  isButtonReply: boolean;
  /**
   * Reação (👍 numa mensagem nossa). Aparece na conversa, mas não é resposta:
   * não conta no relatório e não abre a janela de atendimento.
   */
  isReaction: boolean;
  media: { id: string; mimeType: string | null; filename: string | null } | null;
  contextWamid: string | null;
  at: Date;
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Lê a mensagem do webhook. Sem remetente ou sem id, não há o que gravar. */
export function parseInboundMessage(
  message: WebhookInboundMessage
): ParsedInboundMessage | null {
  const waId = (message.from ?? "").replace(/\D/g, "");
  const wamid = clean(message.id);
  if (!waId || !wamid) return null;

  const type = clean(message.type) ?? "unsupported";
  let body: string | null = null;
  let buttonPayload: string | null = null;
  let isButtonReply = false;
  let media: ParsedInboundMessage["media"] = null;
  // A reação aponta a mensagem reagida no próprio corpo, não em `context`.
  let contextWamid = clean(message.context?.id);

  if (type === "text") {
    body = clean(message.text?.body);
  } else if (type === "button") {
    body = clean(message.button?.text);
    buttonPayload = clean(message.button?.payload);
    isButtonReply = true;
  } else if (type === "interactive") {
    const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
    body = clean(reply?.title);
    buttonPayload = clean(reply?.id);
    isButtonReply = true;
  } else if (isMediaType(type)) {
    const file = message[type];
    body = clean(file?.caption);
    if (clean(file?.id)) {
      media = {
        id: clean(file?.id)!,
        mimeType: clean(file?.mime_type),
        filename: clean(file?.filename),
      };
    }
  } else if (type === "location") {
    const place = message.location;
    body =
      [clean(place?.name), clean(place?.address)].filter(Boolean).join(" — ") ||
      null;
  } else if (type === "contacts") {
    body =
      (message.contacts ?? [])
        .map((c) =>
          [clean(c.name?.formatted_name), clean(c.phones?.[0]?.phone)]
            .filter(Boolean)
            .join(" ")
        )
        .filter(Boolean)
        .join(", ") || null;
  } else if (type === "reaction") {
    // Emoji vazio = a pessoa retirou a reação.
    body = clean(message.reaction?.emoji);
    contextWamid = clean(message.reaction?.message_id) ?? contextWamid;
  }

  return {
    wamid,
    waId,
    type,
    body,
    buttonPayload,
    isButtonReply,
    isReaction: type === "reaction",
    media,
    contextWamid,
    at: parseWebhookTimestamp(message.timestamp),
  };
}

const TYPE_LABELS: Record<string, string> = {
  image: "📷 Foto",
  audio: "🎤 Áudio",
  video: "🎥 Vídeo",
  document: "📄 Documento",
  sticker: "Figurinha",
  location: "📍 Localização",
  contacts: "👤 Contato",
};

/** Resumo de uma linha para a lista de conversas. */
export function messagePreview(message: {
  type: string;
  body: string | null;
}): string {
  if (message.type === "reaction") {
    return message.body ? `Reagiu ${message.body}` : "Retirou a reação";
  }
  const label = TYPE_LABELS[message.type];
  if (label) return message.body ? `${label}: ${message.body}` : label;
  if (message.body) return message.body;
  return "Mensagem sem texto";
}

// ─── Janela de atendimento ─────────────────────────────────────────────────

/**
 * A regra da Meta: texto livre só até 24h depois da última mensagem do
 * contato. Fora dela a Cloud API ACEITA o envio e o recusa minutos depois pelo
 * webhook (erro 131047) — por isso a trava vem antes, aqui.
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function serviceWindow(
  lastInboundAt: Date | string | null,
  now: Date = new Date()
): { open: boolean; closesAt: Date | null } {
  if (!lastInboundAt) return { open: false, closesAt: null };
  const closesAt = new Date(new Date(lastInboundAt).getTime() + SERVICE_WINDOW_MS);
  return { open: closesAt.getTime() > now.getTime(), closesAt };
}

/** Limite da Cloud API para o corpo de uma mensagem de texto. */
export const WHATSAPP_TEXT_MAX = 4096;

// ─── A que envio a mensagem responde ───────────────────────────────────────

/**
 * Resposta SEM citação vale para o envio de WhatsApp mais recente ao contato —
 * desde que ele seja deste período. Sem teto, um "oi" de três meses depois
 * contaria como resposta à última campanha, e o relatório dela mudaria sozinho.
 */
export const REPLY_ATTRIBUTION_DAYS = 30;

/**
 * Como procurar o envio a que a mensagem responde:
 *  - com citação (todo toque de botão tem): SÓ o envio citado. Se o citado não
 *    é de campanha — um teste de modelo, uma resposta da equipe —, a mensagem
 *    não é resposta a campanha nenhuma. Cair no "mais recente" aí gravaria o
 *    botão do teste numa campanha antiga do mesmo contato;
 *  - sem citação: o envio mais recente dentro de REPLY_ATTRIBUTION_DAYS.
 *  - reação: nenhum.
 */
export function attributionStrategy(message: {
  contextWamid: string | null;
  isReaction: boolean;
}): "context" | "recent" | "none" {
  if (message.isReaction) return "none";
  return message.contextWamid ? "context" : "recent";
}

/**
 * Se a mensagem vira evento `whatsapp_replied` (gatilho de automação e ponto
 * no Lead Score, +15 cada).
 *
 * Um evento por MENSAGEM inflaria a pontuação na primeira conversa de verdade:
 * dez mensagens trocadas valeriam 150 pontos. Vira evento o que é sinal novo —
 * o toque num botão (uma decisão, e o que uma automação quer ouvir), a
 * primeira resposta a um envio, ou a volta do contato depois que a janela de
 * atendimento anterior fechou.
 */
export function shouldEmitRepliedEvent(args: {
  isButtonReply: boolean;
  firstReplyToSend: boolean;
  previousInboundAt: Date | null;
  at: Date;
}): boolean {
  if (args.isButtonReply || args.firstReplyToSend) return true;
  if (!args.previousInboundAt) return true;
  return args.at.getTime() - args.previousInboundAt.getTime() >= SERVICE_WINDOW_MS;
}

// ─── Telefone ──────────────────────────────────────────────────────────────

/**
 * Formas E.164 sob as quais o número de quem escreveu pode estar cadastrado.
 *
 * No Brasil, o wa_id de muitos celulares chega SEM o nono dígito
 * (55 31 9565-0622), enquanto o cadastro guarda o número com ele
 * (+55 31 99565-0622). Comparar só a forma exata perde a resposta — e o SAIR,
 * que é pior. O inverso também acontece, então as duas formas são tentadas.
 */
export function phoneCandidatesFromWaId(waId: string): string[] {
  const digits = waId.replace(/\D/g, "");
  if (!digits) return [];
  const candidates = [`+${digits}`];
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4);
    if (local.length === 8 && /^[6-9]/.test(local)) {
      candidates.push(`+55${ddd}9${local}`);
    } else if (local.length === 9 && local.startsWith("9")) {
      candidates.push(`+55${ddd}${local.slice(1)}`);
    }
  }
  return candidates;
}
