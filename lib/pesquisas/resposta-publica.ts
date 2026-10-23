// A resposta do parceiro, pelo link: carregar o convite pelo token, gravar
// uma resposta por vez (o parceiro para e volta quando quiser) e concluir.
// A página pública não tem sessão — o token É a credencial, e só alcança o
// convite dele.
import { and, asc, eq, isNull } from "drizzle-orm";

import {
  contacts,
  getDb,
  surveyAnswers,
  surveyInvites,
  surveyQuestions,
  surveys,
  type SurveyAnswerValue,
  type SurveyInviteStatus,
  type SurveyObjective,
} from "@/lib/db";

import {
  aceitaResposta,
  estadoAoAbrir,
  estadoAoResponder,
  gerarToken,
} from "./convites";
import { criarAlertasDaConclusao } from "./mapeamento-db";
import {
  progresso,
  validarResposta,
  type PerguntaDoFormulario,
} from "./respostas";

export interface ConviteCarregado {
  invite: {
    id: string;
    status: SurveyInviteStatus;
    completedAt: string | null;
  };
  survey: {
    id: string;
    name: string;
    objective: SurveyObjective;
    intro: string | null;
    thanks: string | null;
    /** Pesquisa encerrada pela Expansão: o link abre, mas não recebe resposta. */
    ativa: boolean;
  };
  contact: { name: string; company: string | null };
  questions: PerguntaDoFormulario[];
  answers: Record<string, SurveyAnswerValue>;
}

/**
 * Cria o convite de um parceiro para a pesquisa. Um convite aberto por
 * parceiro por pesquisa (índice único parcial): reconvidar exige concluir ou
 * encerrar — quem chama trata a violação (ehViolacaoDeUnico).
 */
export async function criarConvite(args: {
  surveyId: string;
  contactId: string;
  autor: { id: string; name: string } | null;
}): Promise<{ id: string; token: string }> {
  const token = gerarToken();
  const [criado] = await getDb()
    .insert(surveyInvites)
    .values({
      surveyId: args.surveyId,
      contactId: args.contactId,
      token,
      createdByUserId: args.autor?.id ?? null,
      createdByName: args.autor?.name ?? null,
    })
    .returning({ id: surveyInvites.id });
  return { id: criado.id, token };
}

/** O convite pelo token do link, com tudo que a página de resposta mostra. */
export async function carregarConvitePorToken(
  token: string
): Promise<ConviteCarregado | null> {
  const db = getDb();
  const [linha] = await db
    .select({
      inviteId: surveyInvites.id,
      status: surveyInvites.status,
      completedAt: surveyInvites.completedAt,
      surveyId: surveys.id,
      surveyName: surveys.name,
      objective: surveys.objective,
      intro: surveys.intro,
      thanks: surveys.thanks,
      surveyStatus: surveys.status,
      contactName: contacts.name,
      company: contacts.company,
    })
    .from(surveyInvites)
    .innerJoin(surveys, eq(surveys.id, surveyInvites.surveyId))
    .innerJoin(contacts, eq(contacts.id, surveyInvites.contactId))
    .where(eq(surveyInvites.token, token));
  if (!linha) return null;

  const [perguntas, respostas] = await Promise.all([
    db
      .select()
      .from(surveyQuestions)
      .where(
        and(
          eq(surveyQuestions.surveyId, linha.surveyId),
          isNull(surveyQuestions.archivedAt)
        )
      )
      .orderBy(asc(surveyQuestions.position), asc(surveyQuestions.createdAt)),
    db
      .select({ questionId: surveyAnswers.questionId, value: surveyAnswers.value })
      .from(surveyAnswers)
      .where(eq(surveyAnswers.inviteId, linha.inviteId)),
  ]);

  return {
    invite: {
      id: linha.inviteId,
      status: linha.status,
      completedAt: linha.completedAt?.toISOString() ?? null,
    },
    survey: {
      id: linha.surveyId,
      name: linha.surveyName,
      objective: linha.objective,
      intro: linha.intro,
      thanks: linha.thanks,
      ativa: linha.surveyStatus === "active",
    },
    contact: { name: linha.contactName, company: linha.company },
    questions: perguntas.map((p) => ({
      id: p.id,
      type: p.type,
      label: p.label,
      help: p.help,
      required: p.required,
      options: p.options,
    })),
    answers: Object.fromEntries(respostas.map((r) => [r.questionId, r.value])),
  };
}

/**
 * A pesquisa como o parceiro vai vê-la, SEM convite: para a Expansão
 * pré-visualizar com o layout real. Monta um "convite" só de leitura — não
 * existe no banco, nada que a página faça com ele é gravado (a página sabe
 * disso pelo `modoPrevia`). Funciona para rascunho também: `ativa` é true de
 * propósito, para a prévia não abrir como "Pesquisa encerrada".
 */
export async function carregarPesquisaParaPrevia(
  surveyId: string,
  parceiro: { name: string; company: string | null }
): Promise<ConviteCarregado | null> {
  const db = getDb();
  const [pesquisa] = await db
    .select({
      id: surveys.id,
      name: surveys.name,
      objective: surveys.objective,
      intro: surveys.intro,
      thanks: surveys.thanks,
    })
    .from(surveys)
    .where(eq(surveys.id, surveyId));
  if (!pesquisa) return null;

  const perguntas = await db
    .select()
    .from(surveyQuestions)
    .where(and(eq(surveyQuestions.surveyId, surveyId), isNull(surveyQuestions.archivedAt)))
    .orderBy(asc(surveyQuestions.position), asc(surveyQuestions.createdAt));

  return {
    invite: { id: `previa-${surveyId}`, status: "opened", completedAt: null },
    survey: { ...pesquisa, ativa: true },
    contact: parceiro,
    questions: perguntas.map((p) => ({
      id: p.id,
      type: p.type,
      label: p.label,
      help: p.help,
      required: p.required,
      options: p.options,
    })),
    answers: {},
  };
}

/** O parceiro abriu o link: "convidado" vira "abriu" (uma vez). */
export async function marcarAberto(inviteId: string, status: SurveyInviteStatus): Promise<void> {
  const novo = estadoAoAbrir(status);
  if (novo === status) return;
  await getDb()
    .update(surveyInvites)
    .set({ status: novo, openedAt: new Date() })
    .where(and(eq(surveyInvites.id, inviteId), eq(surveyInvites.status, status)));
}

export type ResultadoGravacao =
  | { ok: true; valor: SurveyAnswerValue | null }
  | { ok: false; error: string; status: 400 | 404 | 409 };

/** Grava (ou apaga, com valor vazio) a resposta de UMA pergunta. */
export async function gravarResposta(
  token: string,
  questionId: string,
  valor: unknown
): Promise<ResultadoGravacao> {
  const convite = await carregarConvitePorToken(token);
  if (!convite) return { ok: false, error: "Link inválido.", status: 404 };
  if (!aceitaResposta(convite.invite.status) || !convite.survey.ativa) {
    return { ok: false, error: "Esta pesquisa não recebe mais respostas.", status: 409 };
  }
  const pergunta = convite.questions.find((q) => q.id === questionId);
  if (!pergunta) return { ok: false, error: "Pergunta não encontrada.", status: 404 };

  const validacao = validarResposta(pergunta, valor);
  if (!validacao.ok) return { ok: false, error: validacao.error, status: 400 };

  const db = getDb();
  const agora = new Date();
  if (validacao.valor === null) {
    await db
      .delete(surveyAnswers)
      .where(
        and(
          eq(surveyAnswers.inviteId, convite.invite.id),
          eq(surveyAnswers.questionId, questionId)
        )
      );
  } else {
    await db
      .insert(surveyAnswers)
      .values({
        inviteId: convite.invite.id,
        questionId,
        value: validacao.valor,
        updatedAt: agora,
      })
      .onConflictDoUpdate({
        target: [surveyAnswers.inviteId, surveyAnswers.questionId],
        set: { value: validacao.valor, updatedAt: agora },
      });
  }

  const novo = estadoAoResponder(convite.invite.status);
  if (novo !== convite.invite.status) {
    await db
      .update(surveyInvites)
      .set({ status: novo, startedAt: agora, openedAt: agora })
      .where(
        and(eq(surveyInvites.id, convite.invite.id), eq(surveyInvites.status, convite.invite.status))
      );
  }
  return { ok: true, valor: validacao.valor };
}

export type ResultadoConclusao =
  | { ok: true; thanks: string | null }
  | { ok: false; error: string; status: 400 | 404 | 409; faltam?: string[] };

/** Concluir: todas as obrigatórias respondidas; depois disso, trava. */
export async function concluirConvite(token: string): Promise<ResultadoConclusao> {
  const convite = await carregarConvitePorToken(token);
  if (!convite) return { ok: false, error: "Link inválido.", status: 404 };
  if (convite.invite.status === "completed") {
    return { ok: true, thanks: convite.survey.thanks };
  }
  if (!aceitaResposta(convite.invite.status) || !convite.survey.ativa) {
    return { ok: false, error: "Esta pesquisa não recebe mais respostas.", status: 409 };
  }
  const p = progresso(convite.questions, convite.answers);
  if (p.faltamObrigatorias.length > 0) {
    return {
      ok: false,
      status: 400,
      error:
        p.faltamObrigatorias.length === 1
          ? "Falta responder uma pergunta obrigatória."
          : `Faltam ${p.faltamObrigatorias.length} perguntas obrigatórias.`,
      faltam: p.faltamObrigatorias,
    };
  }
  await getDb()
    .update(surveyInvites)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(surveyInvites.id, convite.invite.id));
  // Mapeamento da Parceria: NPS de 0 a 6 ou escolha de risco vira alerta para
  // a Expansão (48h). Falha aqui não pode atrapalhar o parceiro — a conclusão
  // já está gravada; o alerta é da equipe.
  try {
    await criarAlertasDaConclusao(convite.invite.id);
  } catch (error) {
    console.error("[pesquisas] alerta de risco não gravado:", error);
  }
  return { ok: true, thanks: convite.survey.thanks };
}
