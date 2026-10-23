// Leitura para o relatório de uma pesquisa e para o painel das 3 frentes por
// parceiro. Agregação é de ./relatorio (puro); aqui é só banco.
import { and, asc, desc, eq, exists, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";

import {
  contactLists,
  contacts,
  getDb,
  SURVEY_OBJECTIVES,
  surveyAnswers,
  surveyInvites,
  surveyQuestions,
  surveys,
  type SurveyAnswerValue,
  type SurveyFollowupKind,
  type SurveyInviteClosedReason,
  type SurveyInviteStatus,
  type SurveyObjective,
  type SurveyStatus,
} from "@/lib/db";
import { getBaseUrl } from "@/lib/base-url";
import { naoEhLead } from "@/lib/leads";

import { linkDoConvite } from "./convites";
import { saudeDoParceiro, type Saude } from "./mapeamento";
import { passosPorConvite, perfisDosParceiros, sinaisDeAlerta, type PerfilDto } from "./mapeamento-db";
import {
  relatorio,
  type ConviteDoRelatorio,
  type PerguntaDoRelatorio,
  type Relatorio,
  type RespostaDoRelatorio,
} from "./relatorio";
import type { PerguntaDoFormulario } from "./respostas";

export interface FiltrosDoRelatorio {
  listId: string | null;
  de: Date | null;
  ate: Date | null;
}

export interface DadosBrutos {
  pesquisa: { id: string; name: string; objective: SurveyObjective; status: SurveyStatus };
  perguntas: PerguntaDoRelatorio[];
  respostas: RespostaDoRelatorio[];
  convites: ConviteDoRelatorio[];
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Convite na lista? (filtro por segmentação) */
function naLista(listId: string): SQL {
  return exists(
    getDb()
      .select({ um: contactLists.contactId })
      .from(contactLists)
      .where(and(eq(contactLists.contactId, surveyInvites.contactId), eq(contactLists.listId, listId)))
  );
}

/** Tudo que o relatório e o CSV precisam, já filtrado. */
export async function dadosBrutosDoRelatorio(
  surveyId: string,
  filtros: FiltrosDoRelatorio
): Promise<DadosBrutos | null> {
  const db = getDb();
  const [pesquisa] = await db
    .select({ id: surveys.id, name: surveys.name, objective: surveys.objective, status: surveys.status })
    .from(surveys)
    .where(eq(surveys.id, surveyId));
  if (!pesquisa) return null;

  const condicoes: SQL[] = [eq(surveyInvites.surveyId, surveyId)];
  if (filtros.listId) condicoes.push(naLista(filtros.listId));
  if (filtros.de) condicoes.push(gte(surveyInvites.createdAt, filtros.de));
  if (filtros.ate) condicoes.push(lte(surveyInvites.createdAt, filtros.ate));

  const [convitesRaw, perguntasRaw] = await Promise.all([
    db
      .select({
        id: surveyInvites.id,
        status: surveyInvites.status,
        openedAt: surveyInvites.openedAt,
        startedAt: surveyInvites.startedAt,
        completedAt: surveyInvites.completedAt,
        contactId: contacts.id,
        name: contacts.name,
        company: contacts.company,
      })
      .from(surveyInvites)
      .innerJoin(contacts, eq(contacts.id, surveyInvites.contactId))
      .where(and(...condicoes))
      .orderBy(desc(surveyInvites.createdAt)),
    db
      .select()
      .from(surveyQuestions)
      .where(eq(surveyQuestions.surveyId, surveyId))
      .orderBy(asc(surveyQuestions.position), asc(surveyQuestions.createdAt)),
  ]);

  const convites: ConviteDoRelatorio[] = convitesRaw.map((c) => ({
    id: c.id,
    status: c.status,
    openedAt: iso(c.openedAt),
    startedAt: iso(c.startedAt),
    completedAt: iso(c.completedAt),
    contato: { id: c.contactId, name: c.name, company: c.company },
  }));

  const respostasRaw = convites.length
    ? await db
        .select({
          inviteId: surveyAnswers.inviteId,
          questionId: surveyAnswers.questionId,
          value: surveyAnswers.value,
          updatedAt: surveyAnswers.updatedAt,
        })
        .from(surveyAnswers)
        .where(inArray(surveyAnswers.inviteId, convites.map((c) => c.id)))
    : [];

  return {
    pesquisa,
    perguntas: perguntasRaw.map((p) => ({
      id: p.id,
      type: p.type,
      label: p.label,
      options: p.options,
      isNps: p.isNps,
      arquivada: p.archivedAt !== null,
      position: p.position,
    })),
    respostas: respostasRaw.map((r) => ({
      inviteId: r.inviteId,
      questionId: r.questionId,
      value: r.value,
      updatedAt: r.updatedAt.toISOString(),
    })),
    convites,
  };
}

export interface RelatorioDto {
  pesquisa: DadosBrutos["pesquisa"];
  filtros: { listId: string | null; de: string | null; ate: string | null };
  relatorio: Relatorio;
}

export async function carregarRelatorio(
  surveyId: string,
  filtros: FiltrosDoRelatorio
): Promise<RelatorioDto | null> {
  const dados = await dadosBrutosDoRelatorio(surveyId, filtros);
  if (!dados) return null;
  return {
    pesquisa: dados.pesquisa,
    filtros: { listId: filtros.listId, de: iso(filtros.de), ate: iso(filtros.ate) },
    relatorio: relatorio(dados.perguntas, dados.respostas, dados.convites),
  };
}

// ─── Painel das 3 frentes ──────────────────────────────────────────────────

/** O convite mais recente de um parceiro numa frente. */
export interface FrenteDoParceiro {
  surveyId: string;
  surveyName: string;
  inviteId: string;
  status: SurveyInviteStatus;
  createdAt: string;
  completedAt: string | null;
  respondidas: number;
  total: number;
  /** A nota da pergunta-chave do NPS, quando a frente é NPS e ele respondeu. */
  nps: number | null;
  /** O link do convite (para copiar da ficha do parceiro). */
  link: string;
  // Mapeamento da Parceria: etapa 5, fim da régua, passos e risco assinalado.
  validatedAt: string | null;
  validatedByName: string | null;
  closedReason: SurveyInviteClosedReason | null;
  remindersSent: number;
  passos: SurveyFollowupKind[];
  /** Marcou uma escolha de risco neste convite (gerou alerta). */
  riscoAssinalado: boolean;
}

export type FrentesDoParceiro = Record<SurveyObjective, FrenteDoParceiro | null>;

export interface LinhaDoPainel {
  contact: { id: string; name: string; company: string | null };
  frentes: FrentesDoParceiro;
  /** Classificação e responsável (Mapeamento da Parceria); nulo = nunca preenchido. */
  perfil: PerfilDto | null;
  /** Mapa de saúde: Saudável · Atenção · Em risco · Sem medição. */
  saude: Saude;
  alertasAbertos: number;
}

function frentesVazias(): FrentesDoParceiro {
  return Object.fromEntries(SURVEY_OBJECTIVES.map((o) => [o, null])) as FrentesDoParceiro;
}

/**
 * Convites mais recentes por (parceiro, frente), com progresso e nota do NPS.
 * Só parceiros (lead fica fora, como nas telas). `contactIds` restringe.
 */
async function frentesPorParceiro(contactIds: string[] | null): Promise<Map<string, LinhaDoPainel>> {
  const db = getDb();
  if (contactIds && contactIds.length === 0) return new Map();

  const convites = await db
    .select({
      inviteId: surveyInvites.id,
      status: surveyInvites.status,
      token: surveyInvites.token,
      createdAt: surveyInvites.createdAt,
      completedAt: surveyInvites.completedAt,
      validatedAt: surveyInvites.validatedAt,
      validatedByName: surveyInvites.validatedByName,
      closedReason: surveyInvites.closedReason,
      remindersSent: surveyInvites.remindersSent,
      surveyId: surveys.id,
      surveyName: surveys.name,
      objective: surveys.objective,
      contactId: contacts.id,
      name: contacts.name,
      company: contacts.company,
      respondidas: sql<number>`(
        select count(*) from survey_answers a where a.invite_id = survey_invites.id
      )`.mapWith(Number),
      total: sql<number>`(
        select count(*) from survey_questions q
        where q.survey_id = surveys.id and q.archived_at is null and q.type <> 'section'
      )`.mapWith(Number),
    })
    .from(surveyInvites)
    .innerJoin(surveys, eq(surveys.id, surveyInvites.surveyId))
    .innerJoin(contacts, eq(contacts.id, surveyInvites.contactId))
    .where(
      and(naoEhLead(), contactIds ? inArray(contacts.id, contactIds) : undefined)
    )
    .orderBy(desc(surveyInvites.createdAt));

  const mapa = new Map<string, LinhaDoPainel>();
  const npsInvites: string[] = [];
  const base = getBaseUrl();
  for (const c of convites) {
    const linha: LinhaDoPainel = mapa.get(c.contactId) ?? {
      contact: { id: c.contactId, name: c.name, company: c.company },
      frentes: frentesVazias(),
      perfil: null,
      saude: "sem_medicao",
      alertasAbertos: 0,
    };
    if (!linha.frentes[c.objective]) {
      linha.frentes[c.objective] = {
        surveyId: c.surveyId,
        surveyName: c.surveyName,
        inviteId: c.inviteId,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        completedAt: iso(c.completedAt),
        respondidas: c.respondidas,
        total: c.total,
        nps: null,
        link: linkDoConvite(base, c.token),
        validatedAt: iso(c.validatedAt),
        validatedByName: c.validatedByName,
        closedReason: c.closedReason,
        remindersSent: c.remindersSent,
        passos: [],
        riscoAssinalado: false,
      };
      if (c.objective === "nps") npsInvites.push(c.inviteId);
    }
    mapa.set(c.contactId, linha);
  }

  if (npsInvites.length > 0) {
    const notas = await db
      .select({ inviteId: surveyAnswers.inviteId, value: surveyAnswers.value })
      .from(surveyAnswers)
      .innerJoin(surveyQuestions, eq(surveyQuestions.id, surveyAnswers.questionId))
      .where(and(inArray(surveyAnswers.inviteId, npsInvites), eq(surveyQuestions.isNps, true)));
    const porConvite = new Map(notas.map((n) => [n.inviteId, Number(n.value)]));
    for (const linha of mapa.values()) {
      const f = linha.frentes.nps;
      if (f && porConvite.has(f.inviteId)) f.nps = porConvite.get(f.inviteId) ?? null;
    }
  }

  // Mapeamento da Parceria: perfil, passos da régua, alertas e o mapa de saúde.
  const ids = [...mapa.keys()];
  const inviteIds = [...mapa.values()].flatMap((l) =>
    SURVEY_OBJECTIVES.map((o) => l.frentes[o]?.inviteId).filter((id): id is string => Boolean(id))
  );
  const [perfis, passos, sinais] = await Promise.all([
    perfisDosParceiros(ids),
    passosPorConvite(inviteIds),
    sinaisDeAlerta({ contactIds: ids, inviteIds }),
  ]);
  for (const linha of mapa.values()) {
    linha.perfil = perfis.get(linha.contact.id) ?? null;
    linha.alertasAbertos = sinais.abertosPorContato.get(linha.contact.id) ?? 0;
    let riscoAssinalado = false;
    for (const o of SURVEY_OBJECTIVES) {
      const f = linha.frentes[o];
      if (!f) continue;
      f.passos = passos.get(f.inviteId)?.kinds ?? [];
      f.riscoAssinalado = sinais.riscoPorConvite.has(f.inviteId);
      riscoAssinalado ||= f.riscoAssinalado;
    }
    linha.saude = saudeDoParceiro({
      nps: linha.frentes.nps?.nps ?? null,
      riscoAssinalado,
      alertaAberto: linha.alertasAbertos > 0,
    });
  }
  return mapa;
}

/** Com lista: todos os parceiros dela (convidados ou não). Sem: quem tem convite. */
export async function painelDeParceiros(listId: string | null): Promise<LinhaDoPainel[]> {
  const db = getDb();
  if (!listId) {
    return [...(await frentesPorParceiro(null)).values()].sort((a, b) =>
      a.contact.name.localeCompare(b.contact.name, "pt-BR")
    );
  }
  const membros = await db
    .select({ id: contacts.id, name: contacts.name, company: contacts.company })
    .from(contactLists)
    .innerJoin(contacts, eq(contacts.id, contactLists.contactId))
    .where(and(eq(contactLists.listId, listId), naoEhLead()))
    .orderBy(asc(contacts.name));
  const [frentes, perfis] = await Promise.all([
    frentesPorParceiro(membros.map((m) => m.id)),
    perfisDosParceiros(membros.map((m) => m.id)),
  ]);
  return membros.map(
    (m) =>
      frentes.get(m.id) ?? {
        contact: { id: m.id, name: m.name, company: m.company },
        frentes: frentesVazias(),
        perfil: perfis.get(m.id) ?? null,
        saude: "sem_medicao" as const,
        alertasAbertos: 0,
      }
  );
}

export async function frentesResumidasDoParceiro(contactId: string): Promise<FrentesDoParceiro> {
  const mapa = await frentesPorParceiro([contactId]);
  return mapa.get(contactId)?.frentes ?? frentesVazias();
}

export interface FrenteComRespostas extends FrenteDoParceiro {
  perguntas: PerguntaDoFormulario[];
  respostas: Record<string, SurveyAnswerValue>;
}

export interface ParceiroDto {
  contact: { id: string; name: string; company: string | null };
  frentes: Record<SurveyObjective, FrenteComRespostas | null>;
  perfil: PerfilDto | null;
  saude: Saude;
  alertasAbertos: number;
}

/** O parceiro nas 3 frentes, com as respostas do convite mais recente de cada. */
export async function frentesDoParceiro(contactId: string): Promise<ParceiroDto | null> {
  const db = getDb();
  const [contact] = await db
    .select({ id: contacts.id, name: contacts.name, company: contacts.company })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), naoEhLead()));
  if (!contact) return null;

  const linha = (await frentesPorParceiro([contactId])).get(contactId);
  const resumo = linha?.frentes ?? frentesVazias();
  const frentes = Object.fromEntries(
    SURVEY_OBJECTIVES.map((o) => [o, null])
  ) as ParceiroDto["frentes"];

  for (const objective of SURVEY_OBJECTIVES) {
    const f = resumo[objective];
    if (!f) continue;
    const [perguntas, respostas] = await Promise.all([
      db
        .select()
        .from(surveyQuestions)
        .where(and(eq(surveyQuestions.surveyId, f.surveyId), isNull(surveyQuestions.archivedAt)))
        .orderBy(asc(surveyQuestions.position), asc(surveyQuestions.createdAt)),
      db
        .select({ questionId: surveyAnswers.questionId, value: surveyAnswers.value })
        .from(surveyAnswers)
        .where(eq(surveyAnswers.inviteId, f.inviteId)),
    ]);
    frentes[objective] = {
      ...f,
      perguntas: perguntas.map((p) => ({
        id: p.id,
        type: p.type,
        label: p.label,
        help: p.help,
        required: p.required,
        options: p.options,
      })),
      respostas: Object.fromEntries(respostas.map((r) => [r.questionId, r.value])),
    };
  }
  // Sem convite nenhum, o perfil ainda pode existir (classificação dada antes do convite).
  const perfil = linha?.perfil ?? (await perfisDosParceiros([contactId])).get(contactId) ?? null;
  return {
    contact,
    frentes,
    perfil,
    saude: linha?.saude ?? "sem_medicao",
    alertasAbertos: linha?.alertasAbertos ?? 0,
  };
}
