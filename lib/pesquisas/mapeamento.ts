// As regras do projeto "Mapeamento da Parceria" (Expansão, 23/10/2026), sem
// banco: as cinco etapas de cada parceiro por fase, a régua de follow-up, o
// mapa de saúde, os alertas de risco com prazo de 48h e os indicadores.
// Quem lê do banco está em mapeamento-db.ts; as telas importam daqui.
import type {
  PartnerTier,
  SurveyAlertReason,
  SurveyAnswerValue,
  SurveyFollowupKind,
  SurveyInviteClosedReason,
  SurveyInviteStatus,
  SurveyQuestionOptions,
  SurveyQuestionType,
} from "@/lib/db/schema";

// ─── Etapas: Enviado → Abriu → Iniciou → Concluiu → Validado ───────────────

export const ETAPAS = ["enviado", "abriu", "iniciou", "concluiu", "validado"] as const;
export type Etapa = (typeof ETAPAS)[number];

export const ETAPA_LABEL: Record<Etapa, string> = {
  enviado: "Enviado",
  abriu: "Abriu",
  iniciou: "Iniciou",
  concluiu: "Concluiu",
  validado: "Validado",
};

export interface ConviteComEtapa {
  status: SurveyInviteStatus;
  validatedAt: string | Date | null;
  closedReason?: SurveyInviteClosedReason | null;
}

export interface EtapaDoConvite {
  /** 0..4 na régua de etapas; -1 quando o convite foi encerrado sem resposta. */
  indice: number;
  chave: Etapa | "encerrado";
  rotulo: string;
}

/** Em que etapa o parceiro está nesta fase. Encerrado sem concluir fica fora da régua. */
export function etapaDoConvite(c: ConviteComEtapa): EtapaDoConvite {
  if (c.status === "closed") {
    return {
      indice: -1,
      chave: "encerrado",
      rotulo: c.closedReason === "sem_resposta" ? "Sem resposta" : "Encerrado",
    };
  }
  if (c.status === "completed") {
    return c.validatedAt
      ? { indice: 4, chave: "validado", rotulo: ETAPA_LABEL.validado }
      : { indice: 3, chave: "concluiu", rotulo: ETAPA_LABEL.concluiu };
  }
  if (c.status === "in_progress") return { indice: 2, chave: "iniciou", rotulo: ETAPA_LABEL.iniciou };
  if (c.status === "opened") return { indice: 1, chave: "abriu", rotulo: ETAPA_LABEL.abriu };
  return { indice: 0, chave: "enviado", rotulo: ETAPA_LABEL.enviado };
}

// ─── Régua de follow-up ────────────────────────────────────────────────────

export interface PassoDaRegua {
  dia: number;
  chave: "convite" | "lembrete" | "mensagem" | "ligacao" | "reuniao";
  canal: string;
  responsavel: "Marketing" | "Expansão";
  acao: string;
}

/** Os prazos do projeto: do lembrete automático ao contato pessoal. */
export const REGUA: readonly PassoDaRegua[] = [
  { dia: 0, chave: "convite", canal: "WhatsApp e e-mail", responsavel: "Marketing", acao: "Envio do convite com o link do formulário" },
  { dia: 3, chave: "lembrete", canal: "WhatsApp", responsavel: "Marketing", acao: "Lembrete curto para quem não abriu ou não concluiu" },
  { dia: 7, chave: "mensagem", canal: "WhatsApp individual", responsavel: "Expansão", acao: "Mensagem pessoal do responsável pelo parceiro" },
  { dia: 10, chave: "ligacao", canal: "Ligação", responsavel: "Expansão", acao: "Contato direto e oferta de responder junto" },
  { dia: 14, chave: "reuniao", canal: "Reunião", responsavel: "Expansão", acao: "Resposta assistida ou \"sem resposta\" no sistema" },
];

const DIA_MS = 24 * 60 * 60 * 1000;

/** D+N: dias inteiros desde o convite (D0). Nunca negativo. */
export function diaDoConvite(createdAt: string | Date, agora: Date = new Date()): number {
  const inicio = new Date(createdAt).getTime();
  return Math.max(0, Math.floor((agora.getTime() - inicio) / DIA_MS));
}

export interface ConviteNaRegua {
  status: SurveyInviteStatus;
  createdAt: string | Date;
  remindersSent: number;
  /** Passos que a Expansão já registrou neste convite. */
  passos: SurveyFollowupKind[];
}

export interface PassoPendente {
  passo: PassoDaRegua;
  /** Dias até o passo (≥ 0) ou, negativo, dias de atraso. */
  faltam: number;
}

function passoFeito(passo: PassoDaRegua, c: ConviteNaRegua): boolean {
  switch (passo.chave) {
    case "convite":
      return true;
    case "lembrete":
      return c.remindersSent > 0;
    case "mensagem":
      return c.passos.includes("mensagem");
    case "ligacao":
      return c.passos.includes("ligacao");
    case "reuniao":
      return c.passos.includes("reuniao") || c.passos.includes("resposta_assistida");
  }
}

/**
 * O próximo passo da régua para um convite ainda aberto: o primeiro que não
 * foi feito, com quantos dias faltam (ou de atraso). Concluído ou encerrado
 * não tem passo; régua esgotada (tudo feito) também não.
 */
export function proximoPasso(c: ConviteNaRegua, agora: Date = new Date()): PassoPendente | null {
  if (c.status === "completed" || c.status === "closed") return null;
  const dia = diaDoConvite(c.createdAt, agora);
  for (const passo of REGUA) {
    if (passoFeito(passo, c)) continue;
    return { passo, faltam: passo.dia - dia };
  }
  return null;
}

export const PASSO_LABEL: Record<SurveyFollowupKind, string> = {
  mensagem: "Mensagem pessoal (D+7)",
  ligacao: "Ligação (D+10)",
  reuniao: "Reunião (D+14)",
  resposta_assistida: "Resposta assistida",
  sem_resposta: "Sem resposta (encerra o convite)",
};

// ─── Classificação e saúde ─────────────────────────────────────────────────

export const TIER_LABEL: Record<PartnerTier, string> = {
  diamante: "Diamante",
  ouro: "Ouro",
  prata: "Prata",
  bronze: "Bronze",
};

export const SAUDES = ["em_risco", "atencao", "saudavel", "sem_medicao"] as const;
export type Saude = (typeof SAUDES)[number];

export const SAUDE_LABEL: Record<Saude, string> = {
  saudavel: "Saudável",
  atencao: "Atenção",
  em_risco: "Em risco",
  sem_medicao: "Sem medição",
};

export interface SinaisDeSaude {
  /** Nota do NPS mais recente, se respondeu. */
  nps: number | null;
  /** Marcou uma escolha de risco na pesquisa mais recente. */
  riscoAssinalado: boolean;
  /** Tem alerta ainda não tratado. */
  alertaAberto: boolean;
}

/** Mapa de saúde do projeto: Saudável · Atenção · Em risco (ou sem medição). */
export function saudeDoParceiro(s: SinaisDeSaude): Saude {
  if (s.alertaAberto || s.riscoAssinalado || (s.nps !== null && s.nps <= 6)) return "em_risco";
  if (s.nps === null) return "sem_medicao";
  return s.nps >= 9 ? "saudavel" : "atencao";
}

// ─── Alertas de risco ──────────────────────────────────────────────────────

export const PRAZO_ALERTA_HORAS = 48;
export const NPS_MAXIMO_DE_RISCO = 6;

export const ALERTA_MOTIVO_LABEL: Record<SurveyAlertReason, string> = {
  nps: "NPS de 0 a 6",
  risco: "Risco de continuidade",
};

export interface PerguntaParaAlerta {
  id: string;
  type: SurveyQuestionType;
  label: string;
  isNps?: boolean;
  options: SurveyQuestionOptions | null;
}

export interface AlertaDetectado {
  reason: SurveyAlertReason;
  questionId: string;
  detail: string;
}

function escolhasMarcadas(valor: SurveyAnswerValue | null | undefined): string[] {
  if (typeof valor === "string") return [valor];
  if (Array.isArray(valor)) return valor.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * O que, nas respostas, pede contato da Expansão em 48h: nota do NPS de 0 a 6
 * e escolhas marcadas como risco (options.alertOn). No máximo um alerta por
 * motivo — várias perguntas de risco viram um alerta só, com todas no detalhe.
 */
export function detectarAlertas(
  perguntas: PerguntaParaAlerta[],
  respostas: Record<string, SurveyAnswerValue | null | undefined>
): AlertaDetectado[] {
  const alertas: AlertaDetectado[] = [];
  const riscos: { questionId: string; detail: string }[] = [];
  for (const p of perguntas) {
    const valor = respostas[p.id];
    if (valor === null || valor === undefined) continue;
    if (p.isNps && p.type === "scale" && typeof valor === "number" && valor <= NPS_MAXIMO_DE_RISCO) {
      alertas.push({ reason: "nps", questionId: p.id, detail: `NPS ${valor}` });
      continue;
    }
    const gatilhos = p.options?.alertOn ?? [];
    if (gatilhos.length === 0) continue;
    const marcadas = escolhasMarcadas(valor).filter((e) => gatilhos.includes(e));
    if (marcadas.length > 0) riscos.push({ questionId: p.id, detail: `${p.label}: ${marcadas.join(", ")}` });
  }
  if (riscos.length > 0) {
    alertas.push({ reason: "risco", questionId: riscos[0].questionId, detail: riscos.map((r) => r.detail).join(" · ") });
  }
  return alertas;
}

export function prazoDoAlerta(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PRAZO_ALERTA_HORAS * 60 * 60 * 1000);
}

export type SituacaoDoAlerta = "no_prazo" | "vencido" | "tratado_no_prazo" | "tratado_atrasado";

export function situacaoDoAlerta(
  a: { dueAt: string | Date; handledAt: string | Date | null },
  agora: Date = new Date()
): SituacaoDoAlerta {
  const prazo = new Date(a.dueAt).getTime();
  if (a.handledAt) return new Date(a.handledAt).getTime() <= prazo ? "tratado_no_prazo" : "tratado_atrasado";
  return agora.getTime() <= prazo ? "no_prazo" : "vencido";
}

export const SITUACAO_ALERTA_LABEL: Record<SituacaoDoAlerta, string> = {
  no_prazo: "No prazo",
  vencido: "Vencido",
  tratado_no_prazo: "Tratado no prazo",
  tratado_atrasado: "Tratado com atraso",
};

// ─── Indicadores do projeto ────────────────────────────────────────────────

function percentual(numerador: number, denominador: number): number | null {
  return denominador === 0 ? null : Math.round((numerador / denominador) * 100);
}

/** Taxa de resposta por fase: concluíram ÷ convidados (encerrados contam no total). */
export function taxaDeResposta(convites: { status: SurveyInviteStatus }[]): number | null {
  return percentual(convites.filter((c) => c.status === "completed").length, convites.length);
}

/** Base com cadastro completo e validado: validados ÷ concluídos. */
export function percentualValidado(convites: { status: SurveyInviteStatus; validatedAt: string | Date | null }[]): number | null {
  const concluidos = convites.filter((c) => c.status === "completed");
  return percentual(concluidos.filter((c) => c.validatedAt).length, concluidos.length);
}

/** Alertas tratados em 48h ÷ todos os alertas (aberto e vencido conta contra). */
export function alertasTratadosNoPrazo(
  alertas: { dueAt: string | Date; handledAt: string | Date | null }[],
  agora: Date = new Date()
): number | null {
  return percentual(
    alertas.filter((a) => situacaoDoAlerta(a, agora) === "tratado_no_prazo").length,
    alertas.length
  );
}
