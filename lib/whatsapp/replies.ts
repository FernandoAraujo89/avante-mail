import type { WhatsAppButton } from "./types";

// Apuração das respostas de uma campanha de WhatsApp: quantos tocaram cada
// botão de resposta rápida, quantos responderam escrevendo e quantos não
// responderam. Pura — a tela do relatório, a rota JSON e a exportação leem
// daqui, para os três contarem igual.

export interface ReplySend {
  status: string;
  deliveredAt: Date | string | null;
  repliedAt: Date | string | null;
  replyButton: string | null;
}

export type ReplyKind =
  | { kind: "button"; text: string }
  | { kind: "text" }
  | { kind: "none" };

/** A resposta de um envio: o botão tocado vale mais que o texto escrito. */
export function replyOf(send: ReplySend): ReplyKind {
  if (send.replyButton?.trim()) {
    return { kind: "button", text: send.replyButton.trim() };
  }
  if (send.repliedAt) return { kind: "text" };
  return { kind: "none" };
}

/** Chegou ao aparelho — a base das porcentagens de resposta. */
export function reachedRecipient(send: ReplySend): boolean {
  // Quem respondeu recebeu, mesmo que a confirmação de entrega não tenha vindo.
  return (
    send.deliveredAt !== null ||
    send.status === "read" ||
    send.repliedAt !== null ||
    Boolean(send.replyButton)
  );
}

export interface ButtonTally {
  text: string;
  count: number;
  /**
   * Botão que existe no modelo hoje. Falso para um texto que só aparece nas
   * respostas — o modelo foi editado depois do disparo. Continua na conta:
   * a pessoa respondeu aquilo.
   */
  inTemplate: boolean;
}

export interface ReplyBreakdown {
  /** Os botões na ordem do modelo (inclusive os que ninguém tocou). */
  buttons: ButtonTally[];
  /** Responderam escrevendo, sem tocar botão nenhum. */
  textOnly: number;
  /** Receberam e não responderam. */
  noReply: number;
  /** Responderam de qualquer forma. */
  replied: number;
  /** Receberam — o denominador das porcentagens. */
  reached: number;
}

/** Os textos dos botões de resposta rápida, na ordem do modelo. */
export function quickReplyTexts(buttons: WhatsAppButton[] | null): string[] {
  return (buttons ?? [])
    .filter((b) => b.type === "QUICK_REPLY")
    .map((b) => b.text.trim())
    .filter(Boolean);
}

export function replyBreakdown(
  sends: ReplySend[],
  templateButtons: WhatsAppButton[] | null
): ReplyBreakdown {
  const tallies = new Map<string, ButtonTally>();
  for (const text of quickReplyTexts(templateButtons)) {
    tallies.set(text, { text, count: 0, inTemplate: true });
  }

  let textOnly = 0;
  let replied = 0;
  let reached = 0;

  for (const send of sends) {
    if (reachedRecipient(send)) reached++;
    const reply = replyOf(send);
    if (reply.kind === "none") continue;
    replied++;
    if (reply.kind === "text") {
      textOnly++;
      continue;
    }
    const tally = tallies.get(reply.text) ?? {
      text: reply.text,
      count: 0,
      inTemplate: false,
    };
    tally.count++;
    tallies.set(reply.text, tally);
  }

  return {
    buttons: [...tallies.values()],
    textOnly,
    noReply: Math.max(0, reached - replied),
    replied,
    reached,
  };
}
