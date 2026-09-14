import { SERVICE_WINDOW_MS } from "./inbound";

// Resposta automática do número de comunicados — lógica pura, sem I/O.
//
// O número existe para campanhas, não para atendimento: quem escreve para ele
// precisa saber, na hora, para onde ir. A resposta vai com um botão que abre a
// conversa com o Sucesso do Cliente (wa.me), dentro da janela de 24h que a
// própria mensagem do contato abriu — mensagem livre, sem custo, sem modelo.
// Quem envia e registra é lib/whatsapp/conversations.ts.

export interface AutoReplySettings {
  enabled: boolean;
  /** Texto da resposta; {telefone} vira o número do atendimento, formatado. */
  text: string;
  /** Rótulo do botão que abre a conversa com o atendimento. */
  buttonText: string;
  /** WhatsApp do atendimento, em E.164. */
  phone: string;
  /**
   * Também quando o contato só toca num botão de resposta rápida do modelo.
   * Desligado por padrão: quem tocou "Sim, vou participar" respondeu à
   * campanha, não pediu atendimento — e receber "aqui não é atendimento" logo
   * depois de confirmar presença soa como bronca.
   */
  afterButtonTaps: boolean;
}

export const AUTO_REPLY_PHONE_PLACEHOLDER = "{telefone}";

export const AUTO_REPLY_DEFAULTS: AutoReplySettings = {
  enabled: true,
  text: `Oi! 👋 Este número é só pra comunicados da Avante e não é um canal de atendimento.

Precisa de ajuda? Chama o nosso time de Sucesso do Cliente no WhatsApp ${AUTO_REPLY_PHONE_PLACEHOLDER} ou toca no botão abaixo.`,
  buttonText: "Falar com o Sucesso",
  phone: "+5537998568320",
  afterButtonTaps: false,
};

/** Limites da Cloud API para a mensagem interativa com botão de link. */
export const AUTO_REPLY_LIMITS = { text: 1024, buttonText: 20 } as const;

/**
 * No máximo uma resposta automática por conversa neste intervalo. Quem manda
 * cinco mensagens seguidas recebe o aviso uma vez, não cinco.
 */
export const AUTO_REPLY_INTERVAL_MS = SERVICE_WINDOW_MS;

/** Nome que aparece no balão da resposta automática, na conversa. */
export const AUTO_REPLY_SENDER_NAME = "Resposta automática";

/** Chave em app_settings. */
export const AUTO_REPLY_SETTING_KEY = "whatsapp_auto_reply";

/** Configuração guardada (JSON) sobre os padrões — o que faltar vem do padrão. */
export function readAutoReplySettings(raw: string | null): AutoReplySettings {
  if (!raw) return AUTO_REPLY_DEFAULTS;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const text = (value: unknown, fallback: string) =>
      typeof value === "string" && value.trim() ? value : fallback;
    return {
      enabled:
        typeof data.enabled === "boolean" ? data.enabled : AUTO_REPLY_DEFAULTS.enabled,
      text: text(data.text, AUTO_REPLY_DEFAULTS.text),
      buttonText: text(data.buttonText, AUTO_REPLY_DEFAULTS.buttonText),
      phone: text(data.phone, AUTO_REPLY_DEFAULTS.phone),
      afterButtonTaps:
        typeof data.afterButtonTaps === "boolean"
          ? data.afterButtonTaps
          : AUTO_REPLY_DEFAULTS.afterButtonTaps,
    };
  } catch {
    return AUTO_REPLY_DEFAULTS;
  }
}

export type ParseAutoReplyResult =
  | { ok: true; data: AutoReplySettings }
  | { ok: false; error: string };

/**
 * Valida o que vem da tela. O telefone passa pelo normalizador recebido (o de
 * lib/phone.ts) — injetado para este módulo continuar puro e testável.
 */
export function parseAutoReplyInput(
  body: unknown,
  normalizePhone: (value: string) => string | null
): ParseAutoReplyResult {
  const data = (body ?? {}) as Record<string, unknown>;
  const text = typeof data.text === "string" ? data.text.trim() : "";
  const buttonText = typeof data.buttonText === "string" ? data.buttonText.trim() : "";
  const rawPhone = typeof data.phone === "string" ? data.phone.trim() : "";

  if (!text) return { ok: false, error: "Escreva o texto da resposta automática." };
  if (text.length > AUTO_REPLY_LIMITS.text) {
    return {
      ok: false,
      error: `O texto pode ter no máximo ${AUTO_REPLY_LIMITS.text} caracteres (tem ${text.length}).`,
    };
  }
  if (!buttonText) return { ok: false, error: "Escreva o texto do botão." };
  if (buttonText.length > AUTO_REPLY_LIMITS.buttonText) {
    return {
      ok: false,
      error: `O texto do botão pode ter no máximo ${AUTO_REPLY_LIMITS.buttonText} caracteres — limite do WhatsApp.`,
    };
  }
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { ok: false, error: "Informe um WhatsApp válido para o atendimento, com DDD." };
  }

  return {
    ok: true,
    data: {
      enabled: data.enabled !== false,
      text,
      buttonText,
      phone,
      afterButtonTaps: data.afterButtonTaps === true,
    },
  };
}

/** Link que abre a conversa com o número no WhatsApp. */
export function waMeLink(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}`;
}

/**
 * Número brasileiro no jeito que se escreve aqui: +55 37 99856-8320. O
 * formatador geral do sistema separa com espaço ("+55 37 99856 8320"), que é o
 * padrão internacional — correto, mas não é como o contato anota um telefone.
 */
export function formatBrazilianPhone(e164: string): string | null {
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return match ? `+55 ${match[1]} ${match[2]}-${match[3]}` : null;
}

export interface AutoReplyContent {
  /** Texto com o número no lugar de {telefone}. */
  body: string;
  buttonText: string;
  url: string;
  /** A mesma resposta sem botão, para quando a mensagem interativa for recusada. */
  fallbackText: string;
}

export function buildAutoReply(
  settings: AutoReplySettings,
  formatPhone: (e164: string) => string
): AutoReplyContent {
  const url = waMeLink(settings.phone);
  const body = settings.text
    .split(AUTO_REPLY_PHONE_PLACEHOLDER)
    .join(formatBrazilianPhone(settings.phone) ?? formatPhone(settings.phone));
  return {
    body,
    buttonText: settings.buttonText,
    url,
    fallbackText: `${body}\n\n${url}`,
  };
}

export type AutoReplySkipReason =
  | "disabled"
  | "reaction"
  | "system"
  | "opt_out"
  | "button"
  | "team_active"
  | "recent";

/**
 * Se a mensagem recebida ganha a resposta automática. Não ganha:
 *  - reação e aviso de sistema (troca de número): não são alguém escrevendo;
 *  - SAIR/PARAR: o contato já recebe a confirmação do descadastro;
 *  - toque em botão de resposta rápida, a não ser que a configuração peça;
 *  - conversa em que alguém da equipe respondeu nas últimas 24h: é o caso
 *    especial em que o atendimento acontece aqui, e o aviso desmentiria a
 *    própria equipe;
 *  - conversa que já recebeu o aviso nas últimas 24h.
 */
export function autoReplyDecision(args: {
  settings: AutoReplySettings;
  message: { type: string; isReaction: boolean; isButtonReply: boolean };
  isOptOut: boolean;
  lastTeamReplyAt: Date | null;
  lastAutoReplyAt: Date | null;
  now: Date;
}): { send: true } | { send: false; reason: AutoReplySkipReason } {
  const { settings, message, now } = args;
  if (!settings.enabled) return { send: false, reason: "disabled" };
  if (message.isReaction) return { send: false, reason: "reaction" };
  if (message.type === "system") return { send: false, reason: "system" };
  if (args.isOptOut) return { send: false, reason: "opt_out" };
  if (message.isButtonReply && !settings.afterButtonTaps) {
    return { send: false, reason: "button" };
  }
  const within = (at: Date | null) =>
    at !== null && now.getTime() - at.getTime() < AUTO_REPLY_INTERVAL_MS;
  if (within(args.lastTeamReplyAt)) return { send: false, reason: "team_active" };
  if (within(args.lastAutoReplyAt)) return { send: false, reason: "recent" };
  return { send: true };
}
