// Pesquisas com parceiros: leitura com contagens, criação e o salvamento da
// lista de perguntas do construtor. As regras (validação, diff, transição de
// situação) são puras e vivem em ./perguntas; aqui é só banco.
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";

import {
  getDb,
  surveyAnswers,
  surveyQuestions,
  surveys,
  whatsappTemplates,
  type SurveyObjective,
  type SurveyStatus,
} from "@/lib/db";
import { isLinhaConfigurada } from "@/lib/whatsapp/client";
import type { WhatsAppVariableMap } from "@/lib/whatsapp/types";

import type { DiffPerguntas, PerguntaExistente } from "./perguntas";
import type { PerguntaDto, PesquisaDto, PesquisaResumoDto } from "./rotulos";
import { prontidaoDoWhatsApp } from "./whatsapp";

export * from "./rotulos";

// Subconsultas correlacionadas. A coluna de fora vai por extenso
// (surveys.id): interpolada pelo Drizzle ela sai sem a tabela, e aí o
// Postgres a resolve na tabela de DENTRO — contagem sempre zero.
const contagens = {
  questionCount: sql<number>`(
    select count(*) from survey_questions q
    where q.survey_id = surveys.id and q.archived_at is null and q.type <> 'section'
  )`.mapWith(Number),
  inviteCount: sql<number>`(
    select count(*) from survey_invites i where i.survey_id = surveys.id
  )`.mapWith(Number),
  completedCount: sql<number>`(
    select count(*) from survey_invites i
    where i.survey_id = surveys.id and i.status = 'completed'
  )`.mapWith(Number),
};

type LinhaResumo = typeof surveys.$inferSelect & {
  questionCount: number;
  inviteCount: number;
  completedCount: number;
};

function resumo(l: LinhaResumo): PesquisaResumoDto {
  return {
    id: l.id,
    objective: l.objective,
    name: l.name,
    status: l.status,
    questionCount: l.questionCount,
    inviteCount: l.inviteCount,
    completedCount: l.completedCount,
    createdByName: l.createdByName,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

export async function listarPesquisas(): Promise<PesquisaResumoDto[]> {
  const db = getDb();
  const linhas = await db
    .select({ ...getTableColumns(surveys), ...contagens })
    .from(surveys)
    .orderBy(asc(surveys.objective), desc(surveys.createdAt));
  return linhas.map(resumo);
}

/** A pesquisa com as perguntas ativas, na ordem, e quantos já responderam cada uma. */
export async function carregarPesquisa(id: string): Promise<PesquisaDto | null> {
  const db = getDb();
  const [linha] = await db
    .select({ ...getTableColumns(surveys), ...contagens })
    .from(surveys)
    .where(eq(surveys.id, id));
  if (!linha) return null;

  const perguntas = await db
    .select()
    .from(surveyQuestions)
    .where(and(eq(surveyQuestions.surveyId, id), isNull(surveyQuestions.archivedAt)))
    .orderBy(asc(surveyQuestions.position), asc(surveyQuestions.createdAt));

  const respostas = perguntas.length
    ? await db
        .select({
          questionId: surveyAnswers.questionId,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(surveyAnswers)
        .where(inArray(surveyAnswers.questionId, perguntas.map((p) => p.id)))
        .groupBy(surveyAnswers.questionId)
    : [];
  const porPergunta = new Map(respostas.map((r) => [r.questionId, r.count]));

  // O convite por WhatsApp está pronto? (modelo aprovado com link dinâmico +
  // linha da Expansão configurada) — lib/pesquisas/whatsapp.ts
  const [modelo] = linha.whatsappTemplateId
    ? await db
        .select({
          name: whatsappTemplates.name,
          status: whatsappTemplates.status,
          buttons: whatsappTemplates.buttons,
        })
        .from(whatsappTemplates)
        .where(eq(whatsappTemplates.id, linha.whatsappTemplateId))
    : [];
  const whatsapp = prontidaoDoWhatsApp(modelo ?? null, isLinhaConfigurada("expansao"));

  const questions: PerguntaDto[] = perguntas.map((p) => ({
    id: p.id,
    position: p.position,
    type: p.type,
    label: p.label,
    help: p.help,
    required: p.required,
    options: p.options,
    isNps: p.isNps,
    answerCount: porPergunta.get(p.id) ?? 0,
  }));

  return {
    ...resumo(linha),
    intro: linha.intro,
    thanks: linha.thanks,
    emailSubject: linha.emailSubject,
    emailBody: linha.emailBody,
    whatsappTemplateId: linha.whatsappTemplateId,
    whatsappVariables: linha.whatsappVariables,
    whatsapp,
    questions,
  };
}

export async function criarPesquisa(args: {
  objective: SurveyObjective;
  name: string;
  intro: string | null;
  thanks: string | null;
  autor: { id: string; name: string } | null;
}): Promise<string> {
  const [criada] = await getDb()
    .insert(surveys)
    .values({
      objective: args.objective,
      name: args.name,
      intro: args.intro,
      thanks: args.thanks,
      createdByUserId: args.autor?.id ?? null,
      createdByName: args.autor?.name ?? null,
    })
    .returning({ id: surveys.id });
  return criada.id;
}

export async function atualizarPesquisa(
  id: string,
  patch: Partial<{
    name: string;
    intro: string | null;
    thanks: string | null;
    status: SurveyStatus;
    emailSubject: string | null;
    emailBody: string | null;
    whatsappTemplateId: string | null;
    whatsappVariables: WhatsAppVariableMap | null;
  }>
): Promise<void> {
  await getDb()
    .update(surveys)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(surveys.id, id));
}

/** O que o diff precisa saber das perguntas atuais (inclusive arquivadas). */
export async function perguntasExistentes(surveyId: string): Promise<PerguntaExistente[]> {
  const db = getDb();
  const linhas = await db
    .select({
      id: surveyQuestions.id,
      type: surveyQuestions.type,
      archivedAt: surveyQuestions.archivedAt,
      temRespostas: sql<boolean>`exists (
        select 1 from survey_answers a where a.question_id = survey_questions.id
      )`,
    })
    .from(surveyQuestions)
    .where(eq(surveyQuestions.surveyId, surveyId));
  return linhas.map((l) => ({
    id: l.id,
    type: l.type,
    temRespostas: Boolean(l.temRespostas),
    arquivada: l.archivedAt !== null,
  }));
}

/** Aplica o diff numa transação: a lista nova entra inteira ou não entra. */
export async function salvarPerguntas(surveyId: string, diff: DiffPerguntas): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const p of diff.criar) {
      await tx.insert(surveyQuestions).values({
        surveyId,
        position: p.position,
        type: p.type,
        label: p.label,
        help: p.help,
        required: p.required,
        options: p.options,
        isNps: p.isNps,
      });
    }
    for (const p of diff.atualizar) {
      await tx
        .update(surveyQuestions)
        .set({
          position: p.position,
          type: p.type,
          label: p.label,
          help: p.help,
          required: p.required,
          options: p.options,
          isNps: p.isNps,
          archivedAt: null,
        })
        .where(and(eq(surveyQuestions.id, p.id), eq(surveyQuestions.surveyId, surveyId)));
    }
    if (diff.arquivar.length) {
      await tx
        .update(surveyQuestions)
        .set({ archivedAt: new Date(), isNps: false })
        .where(
          and(
            inArray(surveyQuestions.id, diff.arquivar),
            eq(surveyQuestions.surveyId, surveyId)
          )
        );
    }
    if (diff.remover.length) {
      await tx
        .delete(surveyQuestions)
        .where(
          and(
            inArray(surveyQuestions.id, diff.remover),
            eq(surveyQuestions.surveyId, surveyId)
          )
        );
    }
    await tx
      .update(surveys)
      .set({ updatedAt: new Date() })
      .where(eq(surveys.id, surveyId));
  });
}

/**
 * Só some uma pesquisa sem convites — com convite há resposta de parceiro
 * (ou vai haver); aí o caminho é encerrar.
 */
export async function excluirPesquisa(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const [linha] = await db
    .select({ id: surveys.id, inviteCount: contagens.inviteCount })
    .from(surveys)
    .where(eq(surveys.id, id));
  if (!linha) return { ok: false, error: "Pesquisa não encontrada." };
  if (linha.inviteCount > 0) {
    return {
      ok: false,
      error: "Esta pesquisa já tem parceiros convidados. Encerre-a em vez de excluir.",
    };
  }
  await db.delete(surveys).where(eq(surveys.id, id));
  return { ok: true };
}
