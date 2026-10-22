import type { SurveyInviteStatus } from "@/lib/db/schema";

import { estaPendente } from "./convites";

// Quando um convite pode receber lembrete. A trava contra insistência: teto
// de lembretes e intervalo mínimo entre eles (app_settings), para o parceiro
// não ser cobrado todo dia e o número não perder qualidade.

export const LEMBRETE_MAXIMO_PADRAO = 3;
export const LEMBRETE_INTERVALO_HORAS_PADRAO = 48;

export const CHAVE_LEMBRETE_MAXIMO = "pesquisas_lembrete_maximo";
export const CHAVE_LEMBRETE_INTERVALO = "pesquisas_lembrete_intervalo_horas";

export interface LimitesDeLembrete {
  maximo: number;
  intervaloHoras: number;
}

export function lerLimites(
  maximo: string | null,
  intervalo: string | null
): LimitesDeLembrete {
  // Sem configuração (nulo/vazio) vale o padrão — Number(null) seria 0.
  const numero = (v: string | null) => (v === null || v.trim() === "" ? NaN : Number(v));
  const m = numero(maximo);
  const i = numero(intervalo);
  return {
    maximo: Number.isInteger(m) && m >= 0 ? m : LEMBRETE_MAXIMO_PADRAO,
    intervaloHoras: Number.isFinite(i) && i >= 0 ? i : LEMBRETE_INTERVALO_HORAS_PADRAO,
  };
}

export type MotivoSemLembrete = "concluido" | "limite" | "intervalo";

export interface ConviteParaLembrete {
  status: SurveyInviteStatus;
  remindersSent: number;
  lastReminderAt: Date | string | null;
}

/** Null = pode lembrar; senão o motivo de não. */
export function motivoSemLembrete(
  convite: ConviteParaLembrete,
  limites: LimitesDeLembrete,
  agora: Date = new Date()
): MotivoSemLembrete | null {
  if (!estaPendente(convite.status)) return "concluido";
  if (convite.remindersSent >= limites.maximo) return "limite";
  if (convite.lastReminderAt) {
    const ultimo = new Date(convite.lastReminderAt).getTime();
    if (agora.getTime() - ultimo < limites.intervaloHoras * 3_600_000) return "intervalo";
  }
  return null;
}
