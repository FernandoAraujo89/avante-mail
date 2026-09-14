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

// ─── Grupos de resposta ────────────────────────────────────────────────────
// Cada envio que chegou ao contato cai em UM grupo: o botão que ele tocou,
// "respondeu com mensagem" ou "não respondeu". O valor do grupo é o mesmo no
// filtro da tabela do relatório e no link da nova campanha para o grupo — é o
// que garante que a campanha nova vai exatamente para quem a tabela mostrou.

const GROUP_PREFIX = "resposta:";

export const REPLY_GROUP = {
  button: (text: string) => `${GROUP_PREFIX}botao:${text}`,
  text: `${GROUP_PREFIX}texto`,
  none: `${GROUP_PREFIX}nenhuma`,
};

export function isReplyGroup(value: string): boolean {
  return (
    value === REPLY_GROUP.text ||
    value === REPLY_GROUP.none ||
    (value.startsWith(REPLY_GROUP.button("")) &&
      value.length > REPLY_GROUP.button("").length)
  );
}

/** O grupo do envio; null = a mensagem não chegou, e o envio fica fora de todos. */
export function replyGroupOf(send: ReplySend): string | null {
  const reply = replyOf(send);
  if (reply.kind === "button") return REPLY_GROUP.button(reply.text);
  if (reply.kind === "text") return REPLY_GROUP.text;
  return reachedRecipient(send) ? REPLY_GROUP.none : null;
}

/** Rótulo curto do grupo, para o filtro e o nome da campanha nova. */
export function replyGroupLabel(value: string): string {
  if (value === REPLY_GROUP.text) return "Respondeu com mensagem";
  if (value === REPLY_GROUP.none) return "Recebeu e não respondeu";
  return value.slice(REPLY_GROUP.button("").length);
}

/** O grupo numa frase: "que responderam “Sim, vou participar”". */
export function replyGroupSentence(value: string): string {
  if (value === REPLY_GROUP.text) return "que responderam com mensagem, sem tocar em botão";
  if (value === REPLY_GROUP.none) return "que receberam e não responderam";
  return `que responderam “${replyGroupLabel(value)}”`;
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
