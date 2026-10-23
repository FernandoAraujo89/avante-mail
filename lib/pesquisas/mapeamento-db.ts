// Banco do projeto "Mapeamento da Parceria": perfil do parceiro, validação,
// passos da régua, alertas de risco e indicadores. As regras estão em
// ./mapeamento (puro); aqui é só leitura e gravação.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  contacts,
  getDb,
  PARTNER_TIERS,
  partnerProfiles,
  SURVEY_FOLLOWUP_KINDS,
  SURVEY_OBJECTIVES,
  surveyAlerts,
  surveyAnswers,
  surveyFollowups,
  surveyInvites,
  surveyQuestions,
  surveys,
  users,
  type PartnerTier,
  type SurveyAlertReason,
  type SurveyAnswerValue,
  type SurveyFollowupKind,
  type SurveyObjective,
} from "@/lib/db";
import { naoEhLead } from "@/lib/leads";

import {
  alertasTratadosNoPrazo,
  detectarAlertas,
  percentualValidado,
  prazoDoAlerta,
  situacaoDoAlerta,
  taxaDeResposta,
  type SituacaoDoAlerta,
} from "./mapeamento";
import { calcularNps, type Nps } from "./relatorio";

export type Autor = { id: string; name: string } | null;
export type Resultado = { ok: true } | { ok: false; error: string };

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

// ─── Perfil do parceiro ────────────────────────────────────────────────────

export interface PerfilDto {
  tier: PartnerTier | null;
  ownerUserId: string | null;
  ownerName: string | null;
  notes: string | null;
  updatedAt: string | null;
}

export async function perfisDosParceiros(contactIds: string[]): Promise<Map<string, PerfilDto>> {
  if (contactIds.length === 0) return new Map();
  const linhas = await getDb()
    .select()
    .from(partnerProfiles)
    .where(inArray(partnerProfiles.contactId, contactIds));
  return new Map(
    linhas.map((l) => [
      l.contactId,
      { tier: l.tier, ownerUserId: l.ownerUserId, ownerName: l.ownerName, notes: l.notes, updatedAt: iso(l.updatedAt) },
    ])
  );
}

export function ehTier(valor: unknown): valor is PartnerTier {
  return typeof valor === "string" && (PARTNER_TIERS as readonly string[]).includes(valor);
}

/** Grava classificação, responsável e notas. Campo ausente no patch não muda. */
export async function salvarPerfil(
  contactId: string,
  patch: { tier?: PartnerTier | null; ownerUserId?: string | null; notes?: string | null }
): Promise<Resultado> {
  const db = getDb();
  const [contato] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), naoEhLead()));
  if (!contato) return { ok: false, error: "Parceiro não encontrado." };

  const valores: Partial<typeof partnerProfiles.$inferInsert> = { updatedAt: new Date() };
  if (patch.tier !== undefined) valores.tier = patch.tier;
  if (patch.notes !== undefined) valores.notes = patch.notes?.trim() || null;
  if (patch.ownerUserId !== undefined) {
    if (patch.ownerUserId === null) {
      valores.ownerUserId = null;
      valores.ownerName = null;
    } else {
      const [u] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, patch.ownerUserId));
      if (!u) return { ok: false, error: "Responsável não encontrado." };
      valores.ownerUserId = u.id;
      valores.ownerName = u.name;
    }
  }
  await db
    .insert(partnerProfiles)
    .values({ contactId, ...valores })
    .onConflictDoUpdate({ target: partnerProfiles.contactId, set: valores });
  return { ok: true };
}

/** Quem pode responder por um parceiro: a Expansão (e o admin). */
export async function listarResponsaveis(): Promise<{ id: string; name: string }[]> {
  return getDb()
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.role, ["expansao", "admin"]))
    .orderBy(asc(users.name));
}

// ─── Validação (etapa 5) ───────────────────────────────────────────────────

async function conviteDaPesquisa(surveyId: string, inviteId: string) {
  const [c] = await getDb()
    .select({
      id: surveyInvites.id,
      status: surveyInvites.status,
      validatedAt: surveyInvites.validatedAt,
      contactId: surveyInvites.contactId,
    })
    .from(surveyInvites)
    .where(and(eq(surveyInvites.id, inviteId), eq(surveyInvites.surveyId, surveyId)));
  return c ?? null;
}

export async function validarConvite(surveyId: string, inviteId: string, autor: Autor): Promise<Resultado> {
  const c = await conviteDaPesquisa(surveyId, inviteId);
  if (!c) return { ok: false, error: "Convite não encontrado." };
  if (c.status !== "completed") return { ok: false, error: "Só uma resposta concluída pode ser validada." };
  if (c.validatedAt) return { ok: true };
  await getDb()
    .update(surveyInvites)
    .set({ validatedAt: new Date(), validatedByUserId: autor?.id ?? null, validatedByName: autor?.name ?? null })
    .where(eq(surveyInvites.id, inviteId));
  return { ok: true };
}

export async function desfazerValidacao(surveyId: string, inviteId: string): Promise<Resultado> {
  const c = await conviteDaPesquisa(surveyId, inviteId);
  if (!c) return { ok: false, error: "Convite não encontrado." };
  await getDb()
    .update(surveyInvites)
    .set({ validatedAt: null, validatedByUserId: null, validatedByName: null })
    .where(eq(surveyInvites.id, inviteId));
  return { ok: true };
}

// ─── Passos da régua ───────────────────────────────────────────────────────

export interface PassoDto {
  id: string;
  kind: SurveyFollowupKind;
  note: string | null;
  byName: string | null;
  at: string;
}

export function ehPasso(valor: unknown): valor is SurveyFollowupKind {
  return typeof valor === "string" && (SURVEY_FOLLOWUP_KINDS as readonly string[]).includes(valor);
}

export async function listarPassos(inviteId: string): Promise<PassoDto[]> {
  const linhas = await getDb()
    .select()
    .from(surveyFollowups)
    .where(eq(surveyFollowups.inviteId, inviteId))
    .orderBy(desc(surveyFollowups.at));
  return linhas.map((l) => ({ id: l.id, kind: l.kind, note: l.note, byName: l.byName, at: l.at.toISOString() }));
}

/** Os tipos de passo já registrados por convite (para a régua) e o último deles. */
export async function passosPorConvite(
  inviteIds: string[]
): Promise<Map<string, { kinds: SurveyFollowupKind[]; ultimo: PassoDto | null }>> {
  const mapa = new Map<string, { kinds: SurveyFollowupKind[]; ultimo: PassoDto | null }>();
  if (inviteIds.length === 0) return mapa;
  const linhas = await getDb()
    .select()
    .from(surveyFollowups)
    .where(inArray(surveyFollowups.inviteId, inviteIds))
    .orderBy(desc(surveyFollowups.at));
  for (const l of linhas) {
    const atual = mapa.get(l.inviteId) ?? { kinds: [], ultimo: null };
    atual.kinds.push(l.kind);
    if (!atual.ultimo) atual.ultimo = { id: l.id, kind: l.kind, note: l.note, byName: l.byName, at: l.at.toISOString() };
    mapa.set(l.inviteId, atual);
  }
  return mapa;
}

/**
 * Registra um passo da Expansão. "sem_resposta" é o fim da régua (D+14):
 * encerra o convite com esse motivo — o link deixa de aceitar resposta.
 */
export async function registrarPasso(args: {
  surveyId: string;
  inviteId: string;
  kind: SurveyFollowupKind;
  note: string | null;
  autor: Autor;
}): Promise<Resultado> {
  const db = getDb();
  const c = await conviteDaPesquisa(args.surveyId, args.inviteId);
  if (!c) return { ok: false, error: "Convite não encontrado." };
  if (args.kind === "sem_resposta") {
    if (c.status === "completed") return { ok: false, error: "Este parceiro já concluiu a resposta." };
    if (c.status === "closed") return { ok: false, error: "Este convite já está encerrado." };
    await db
      .update(surveyInvites)
      .set({ status: "closed", closedAt: new Date(), closedReason: "sem_resposta" })
      .where(eq(surveyInvites.id, args.inviteId));
  }
  await db.insert(surveyFollowups).values({
    inviteId: args.inviteId,
    kind: args.kind,
    note: args.note?.trim() || null,
    byUserId: args.autor?.id ?? null,
    byName: args.autor?.name ?? null,
  });
  return { ok: true };
}

// ─── Alertas de risco ──────────────────────────────────────────────────────

/**
 * Chamado quando o parceiro conclui: lê as respostas, detecta NPS baixo e
 * escolhas de risco e grava os alertas (um por motivo; repetir não duplica).
 * Devolve quantos nasceram.
 */
export async function criarAlertasDaConclusao(inviteId: string): Promise<number> {
  const db = getDb();
  const [convite] = await db
    .select({ id: surveyInvites.id, surveyId: surveyInvites.surveyId, contactId: surveyInvites.contactId })
    .from(surveyInvites)
    .where(eq(surveyInvites.id, inviteId));
  if (!convite) return 0;
  const [perguntas, respostas] = await Promise.all([
    db
      .select({
        id: surveyQuestions.id,
        type: surveyQuestions.type,
        label: surveyQuestions.label,
        isNps: surveyQuestions.isNps,
        options: surveyQuestions.options,
      })
      .from(surveyQuestions)
      .where(and(eq(surveyQuestions.surveyId, convite.surveyId), isNull(surveyQuestions.archivedAt))),
    db
      .select({ questionId: surveyAnswers.questionId, value: surveyAnswers.value })
      .from(surveyAnswers)
      .where(eq(surveyAnswers.inviteId, inviteId)),
  ]);
  const porPergunta: Record<string, SurveyAnswerValue> = {};
  for (const r of respostas) porPergunta[r.questionId] = r.value;
  const detectados = detectarAlertas(perguntas, porPergunta);
  if (detectados.length === 0) return 0;
  const agora = new Date();
  const inseridos = await db
    .insert(surveyAlerts)
    .values(
      detectados.map((a) => ({
        inviteId,
        surveyId: convite.surveyId,
        contactId: convite.contactId,
        questionId: a.questionId,
        reason: a.reason,
        detail: a.detail,
        createdAt: agora,
        dueAt: prazoDoAlerta(agora),
      }))
    )
    .onConflictDoNothing({ target: [surveyAlerts.inviteId, surveyAlerts.reason] })
    .returning({ id: surveyAlerts.id });
  return inseridos.length;
}

export interface AlertaDto {
  id: string;
  inviteId: string;
  reason: SurveyAlertReason;
  detail: string;
  createdAt: string;
  dueAt: string;
  handledAt: string | null;
  handledByName: string | null;
  note: string | null;
  situacao: SituacaoDoAlerta;
  contact: { id: string; name: string; company: string | null };
  survey: { id: string; name: string; objective: SurveyObjective };
  /** Responsável pelo parceiro na Expansão, se definido. */
  ownerName: string | null;
}

export type EstadoDosAlertas = "abertos" | "tratados" | "todos";

export async function listarAlertas(args: { estado: EstadoDosAlertas; contactId?: string | null }): Promise<AlertaDto[]> {
  const condicoes = [naoEhLead()];
  if (args.estado === "abertos") condicoes.push(isNull(surveyAlerts.handledAt));
  if (args.estado === "tratados") condicoes.push(sql`${surveyAlerts.handledAt} is not null`);
  if (args.contactId) condicoes.push(eq(surveyAlerts.contactId, args.contactId));
  const linhas = await getDb()
    .select({
      id: surveyAlerts.id,
      inviteId: surveyAlerts.inviteId,
      reason: surveyAlerts.reason,
      detail: surveyAlerts.detail,
      createdAt: surveyAlerts.createdAt,
      dueAt: surveyAlerts.dueAt,
      handledAt: surveyAlerts.handledAt,
      handledByName: surveyAlerts.handledByName,
      note: surveyAlerts.note,
      contactId: contacts.id,
      name: contacts.name,
      company: contacts.company,
      surveyId: surveys.id,
      surveyName: surveys.name,
      objective: surveys.objective,
      ownerName: partnerProfiles.ownerName,
    })
    .from(surveyAlerts)
    .innerJoin(contacts, eq(contacts.id, surveyAlerts.contactId))
    .innerJoin(surveys, eq(surveys.id, surveyAlerts.surveyId))
    .leftJoin(partnerProfiles, eq(partnerProfiles.contactId, surveyAlerts.contactId))
    .where(and(...condicoes))
    // Abertos primeiro, o mais vencido no topo; tratados depois, o mais recente primeiro.
    .orderBy(sql`${surveyAlerts.handledAt} is not null`, asc(surveyAlerts.dueAt), desc(surveyAlerts.createdAt));
  const agora = new Date();
  return linhas.map((l) => ({
    id: l.id,
    inviteId: l.inviteId,
    reason: l.reason,
    detail: l.detail,
    createdAt: l.createdAt.toISOString(),
    dueAt: l.dueAt.toISOString(),
    handledAt: iso(l.handledAt),
    handledByName: l.handledByName,
    note: l.note,
    situacao: situacaoDoAlerta({ dueAt: l.dueAt, handledAt: l.handledAt }, agora),
    contact: { id: l.contactId, name: l.name, company: l.company },
    survey: { id: l.surveyId, name: l.surveyName, objective: l.objective },
    ownerName: l.ownerName,
  }));
}

export async function tratarAlerta(alertId: string, autor: Autor, note: string | null): Promise<Resultado> {
  const db = getDb();
  const [a] = await db.select({ id: surveyAlerts.id, handledAt: surveyAlerts.handledAt }).from(surveyAlerts).where(eq(surveyAlerts.id, alertId));
  if (!a) return { ok: false, error: "Alerta não encontrado." };
  if (a.handledAt) return { ok: false, error: "Este alerta já foi tratado." };
  await db
    .update(surveyAlerts)
    .set({ handledAt: new Date(), handledByUserId: autor?.id ?? null, handledByName: autor?.name ?? null, note: note?.trim() || null })
    .where(eq(surveyAlerts.id, alertId));
  return { ok: true };
}

/** Quantos alertas abertos cada parceiro tem, e se marcou risco no convite (por convite). */
export async function sinaisDeAlerta(args: { contactIds: string[]; inviteIds: string[] }): Promise<{
  abertosPorContato: Map<string, number>;
  riscoPorConvite: Set<string>;
}> {
  const abertosPorContato = new Map<string, number>();
  const riscoPorConvite = new Set<string>();
  if (args.contactIds.length === 0) return { abertosPorContato, riscoPorConvite };
  const linhas = await getDb()
    .select({
      contactId: surveyAlerts.contactId,
      inviteId: surveyAlerts.inviteId,
      reason: surveyAlerts.reason,
      handledAt: surveyAlerts.handledAt,
    })
    .from(surveyAlerts)
    .where(inArray(surveyAlerts.contactId, args.contactIds));
  const convites = new Set(args.inviteIds);
  for (const l of linhas) {
    if (!l.handledAt) abertosPorContato.set(l.contactId, (abertosPorContato.get(l.contactId) ?? 0) + 1);
    if (l.reason === "risco" && convites.has(l.inviteId)) riscoPorConvite.add(l.inviteId);
  }
  return { abertosPorContato, riscoPorConvite };
}

export async function contarAlertasAbertos(): Promise<{ abertos: number; vencidos: number }> {
  const [r] = await getDb()
    .select({
      abertos: sql<number>`count(*)`.mapWith(Number),
      vencidos: sql<number>`count(*) filter (where ${surveyAlerts.dueAt} < now())`.mapWith(Number),
    })
    .from(surveyAlerts)
    .where(isNull(surveyAlerts.handledAt));
  return r ?? { abertos: 0, vencidos: 0 };
}

// ─── Indicadores do projeto ────────────────────────────────────────────────

export interface IndicadorDaFase {
  objective: SurveyObjective;
  convidados: number;
  concluidos: number;
  validados: number;
  /** Concluídos ÷ convidados, em %. */
  taxa: number | null;
}

export interface IndicadoresDto {
  fases: IndicadorDaFase[];
  /** Validados ÷ concluídos na Fase 1 (cadastro completo e validado), em %. */
  baseValidada: number | null;
  nps: Nps | null;
  alertas: { total: number; abertos: number; vencidos: number; tratadosNoPrazo: number | null };
}

/** Os quatro números da apresentação do projeto, lidos de todas as rodadas. */
export async function indicadoresDoProjeto(): Promise<IndicadoresDto> {
  const db = getDb();
  const [convites, notas, alertas, abertos] = await Promise.all([
    db
      .select({ objective: surveys.objective, status: surveyInvites.status, validatedAt: surveyInvites.validatedAt })
      .from(surveyInvites)
      .innerJoin(surveys, eq(surveys.id, surveyInvites.surveyId))
      .innerJoin(contacts, eq(contacts.id, surveyInvites.contactId))
      .where(naoEhLead()),
    db
      .select({ value: surveyAnswers.value })
      .from(surveyAnswers)
      .innerJoin(surveyQuestions, eq(surveyQuestions.id, surveyAnswers.questionId))
      .innerJoin(surveyInvites, eq(surveyInvites.id, surveyAnswers.inviteId))
      .where(and(eq(surveyQuestions.isNps, true), eq(surveyInvites.status, "completed"))),
    db.select({ dueAt: surveyAlerts.dueAt, handledAt: surveyAlerts.handledAt }).from(surveyAlerts),
    contarAlertasAbertos(),
  ]);
  const fases = SURVEY_OBJECTIVES.map((objective) => {
    const da = convites.filter((c) => c.objective === objective);
    return {
      objective,
      convidados: da.length,
      concluidos: da.filter((c) => c.status === "completed").length,
      validados: da.filter((c) => c.validatedAt).length,
      taxa: taxaDeResposta(da),
    };
  });
  return {
    fases,
    baseValidada: percentualValidado(convites.filter((c) => c.objective === "dados_empresa")),
    nps: calcularNps(notas.map((n) => Number(n.value)).filter((n) => Number.isFinite(n))),
    alertas: { total: alertas.length, ...abertos, tratadosNoPrazo: alertasTratadosNoPrazo(alertas) },
  };
}
