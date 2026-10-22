import { randomBytes } from "crypto";

import type { SurveyInviteStatus } from "@/lib/db/schema";

// O convite de UM parceiro para UMA pesquisa: o token do link e os estados por
// que ele passa. Regras puras; quem grava é ./resposta-publica.ts e ./envios.ts.

/** 32 bytes em base64url: 43 caracteres, sem "=" — cabe no botão do WhatsApp. */
const TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

export function gerarToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenBemFormado(valor: unknown): valor is string {
  return typeof valor === "string" && TOKEN_REGEX.test(valor);
}

export function linkDoConvite(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/pesquisa/${token}`;
}

/** Concluído ou encerrado: o link abre, mas não aceita mais resposta. */
export function aceitaResposta(status: SurveyInviteStatus): boolean {
  return status !== "completed" && status !== "closed";
}

/** Ainda falta responder: é quem recebe lembrete. */
export function estaPendente(status: SurveyInviteStatus): boolean {
  return aceitaResposta(status);
}

/** Primeira abertura do link: "convidado" vira "abriu". O resto fica. */
export function estadoAoAbrir(status: SurveyInviteStatus): SurveyInviteStatus {
  return status === "pending" ? "opened" : status;
}

/** Primeira resposta gravada: vira "respondendo". */
export function estadoAoResponder(status: SurveyInviteStatus): SurveyInviteStatus {
  return status === "pending" || status === "opened" ? "in_progress" : status;
}
