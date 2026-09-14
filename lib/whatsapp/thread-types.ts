import type { WhatsAppMessageDirection } from "@/lib/db/schema";

import type { WhatsAppMediaHeaderType } from "./types";

// Formato da conversa entre a API e a tela. Mora fora de conversations.ts
// porque aquele arquivo fala com o banco e a tela roda no navegador.

export interface ConversationSummary {
  id: string;
  phone: string;
  contactId: string | null;
  /** Nome do contato; sem contato, o do perfil do WhatsApp; sem os dois, o número. */
  displayName: string;
  company: string | null;
  lastMessageAt: string;
  lastInboundAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: WhatsAppMessageDirection | null;
  unreadCount: number;
}

export interface ConversationDetail extends ConversationSummary {
  profileName: string | null;
  /** O contato pediu SAIR (ou foi desmarcado): não recebe mais campanha. */
  optedOut: boolean;
}

/** Mensagem gravada: o que o contato mandou e o que a equipe respondeu. */
export interface ThreadMessage {
  kind: "message";
  id: string;
  direction: WhatsAppMessageDirection;
  type: string;
  body: string | null;
  hasMedia: boolean;
  mediaMimeType: string | null;
  mediaFilename: string | null;
  /** Resposta da equipe: pending/sent/delivered/read/failed. */
  status: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentByName: string | null;
  /** Botão de link da mensagem (a resposta automática leva um). */
  cta: { text: string; url: string } | null;
  at: string;
  /** Texto da mensagem citada, quando ela está nesta conversa. */
  quoted: string | null;
}

/** Modelo enviado por campanha ou automação, lido de campaign_sends. */
export interface ThreadTemplate {
  kind: "template";
  id: string;
  origin: { type: "campaign" | "automation"; id: string; name: string } | null;
  templateName: string | null;
  headerText: string | null;
  headerMedia: {
    kind: WhatsAppMediaHeaderType;
    url: string;
    filename: string | null;
  } | null;
  /** Corpo com as variáveis preenchidas para este contato. */
  bodyText: string;
  footerText: string | null;
  buttons: string[];
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  at: string;
  /** O botão que o contato tocou neste envio. */
  replyButton: string | null;
}

export type ThreadItem = ThreadMessage | ThreadTemplate;

export interface ConversationThread {
  conversation: ConversationDetail;
  items: ThreadItem[];
  /** A janela de 24h: aberta = texto livre permitido. */
  window: { open: boolean; closesAt: string | null };
  /** O canal está configurado neste servidor (sem isto, não há como responder). */
  canSend: boolean;
}
