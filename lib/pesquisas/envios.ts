// Convites e lembretes de pesquisa: quem foi convidado, convidar por lista,
// lembrar em lote, encerrar/reabrir e montar o e-mail que o worker manda.
// A mensagem vira uma linha de campaign_sends (origem "pesquisa"), pela mesma
// fila do e-mail: entrega e devolução chegam pelos webhooks de sempre.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { getBaseUrl } from "@/lib/base-url";
import { enderecoParaEnvioUnico } from "@/lib/contatos/destinatarios";
import {
  campaignSends,
  contactLists,
  contacts,
  getDb,
  surveyAnswers,
  surveyInvites,
  surveys,
  users,
  type CampaignChannel,
  type SendStatus,
  type SurveyInviteStatus,
  type SurveyMessageKind,
} from "@/lib/db";
import { naoEhLead } from "@/lib/leads";
import { getEmailQueue } from "@/lib/queue";
import { getSetting } from "@/lib/settings";
import { ehViolacaoDeUnico } from "@/lib/utils";

import { estaPendente, linkDoConvite } from "./convites";
import {
  CHAVE_LEMBRETE_INTERVALO,
  CHAVE_LEMBRETE_MAXIMO,
  lerLimites,
  motivoSemLembrete,
  type LimitesDeLembrete,
  type MotivoSemLembrete,
} from "./lembretes";
import {
  assuntoDaMensagem,
  assuntoPadrao,
  corpoPadrao,
  htmlDaMensagem,
  preencherVariaveis,
} from "./mensagens";
import { criarConvite } from "./resposta-publica";

export type CanalDeConvite = "email" | "whatsapp";

/** Canais pedidos pela tela. WhatsApp chega na parte 5 (linha da Expansão). */
export function lerCanais(
  valor: unknown
): { ok: true; canais: CanalDeConvite[] } | { ok: false; error: string } {
  const lista = Array.isArray(valor) ? valor : ["email"];
  const canais: CanalDeConvite[] = [];
  for (const c of lista) {
    if (c === "email") {
      if (!canais.includes("email")) canais.push("email");
    } else if (c === "whatsapp") {
      return {
        ok: false,
        error:
          "O convite por WhatsApp chega com a linha da Expansão — por enquanto, e-mail ou só o link.",
      };
    } else {
      return { ok: false, error: "Canal inválido." };
    }
  }
  return { ok: true, canais };
}

export interface UltimoEnvio {
  channel: CampaignChannel;
  kind: SurveyMessageKind;
  status: SendStatus;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  errorMessage: string | null;
}

export interface ConviteDto {
  id: string;
  contact: {
    id: string;
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
  };
  status: SurveyInviteStatus;
  link: string;
  createdAt: string;
  openedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  remindersSent: number;
  lastReminderAt: string | null;
  /** Perguntas respondidas / perguntas que pedem resposta. */
  respondidas: number;
  total: number;
  ultimoEnvio: UltimoEnvio | null;
  createdByName: string | null;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

export async function listarConvites(surveyId: string): Promise<ConviteDto[]> {
  const db = getDb();
  const [linhas, [totais]] = await Promise.all([
    db
      .select({
        id: surveyInvites.id,
        contactId: contacts.id,
        name: contacts.name,
        company: contacts.company,
        email: contacts.email,
        phone: contacts.phone,
        status: surveyInvites.status,
        token: surveyInvites.token,
        createdAt: surveyInvites.createdAt,
        openedAt: surveyInvites.openedAt,
        startedAt: surveyInvites.startedAt,
        completedAt: surveyInvites.completedAt,
        closedAt: surveyInvites.closedAt,
        remindersSent: surveyInvites.remindersSent,
        lastReminderAt: surveyInvites.lastReminderAt,
        createdByName: surveyInvites.createdByName,
        respondidas: sql<number>`(
          select count(*) from survey_answers a where a.invite_id = survey_invites.id
        )`.mapWith(Number),
      })
      .from(surveyInvites)
      .innerJoin(contacts, eq(contacts.id, surveyInvites.contactId))
      .where(eq(surveyInvites.surveyId, surveyId))
      .orderBy(desc(surveyInvites.createdAt), asc(contacts.name)),
    db
      .select({
        total: sql<number>`(
          select count(*) from survey_questions q
          where q.survey_id = ${surveyId} and q.archived_at is null and q.type <> 'section'
        )`.mapWith(Number),
      })
      .from(surveys)
      .where(eq(surveys.id, surveyId)),
  ]);
  if (linhas.length === 0) return [];

  const envios = await db
    .select({
      inviteId: campaignSends.surveyInviteId,
      channel: campaignSends.channel,
      kind: campaignSends.surveyMessageKind,
      status: campaignSends.status,
      sentAt: campaignSends.sentAt,
      deliveredAt: campaignSends.deliveredAt,
      openedAt: campaignSends.openedAt,
      errorMessage: campaignSends.errorMessage,
    })
    .from(campaignSends)
    .where(inArray(campaignSends.surveyInviteId, linhas.map((l) => l.id)))
    // campaign_sends não tem created_at: o que ainda não saiu (sent_at nulo)
    // é o mais novo, depois o enviado mais recente; entre dois na fila, o
    // lembrete veio depois do convite.
    .orderBy(
      sql`${campaignSends.sentAt} desc nulls first, case when ${campaignSends.surveyMessageKind} = 'reminder' then 0 else 1 end`
    );
  const ultimo = new Map<string, UltimoEnvio>();
  for (const e of envios) {
    if (!e.inviteId || ultimo.has(e.inviteId)) continue;
    ultimo.set(e.inviteId, {
      channel: e.channel,
      kind: e.kind ?? "invite",
      status: e.status,
      sentAt: iso(e.sentAt),
      deliveredAt: iso(e.deliveredAt),
      openedAt: iso(e.openedAt),
      errorMessage: e.errorMessage,
    });
  }

  const base = getBaseUrl();
  return linhas.map((l) => ({
    id: l.id,
    contact: { id: l.contactId, name: l.name, company: l.company, email: l.email, phone: l.phone },
    status: l.status,
    link: linkDoConvite(base, l.token),
    createdAt: l.createdAt.toISOString(),
    openedAt: iso(l.openedAt),
    startedAt: iso(l.startedAt),
    completedAt: iso(l.completedAt),
    closedAt: iso(l.closedAt),
    remindersSent: l.remindersSent,
    lastReminderAt: iso(l.lastReminderAt),
    respondidas: l.respondidas,
    total: totais?.total ?? 0,
    ultimoEnvio: ultimo.get(l.id) ?? null,
    createdByName: l.createdByName,
  }));
}

const OPCOES_DO_JOB = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 3000 },
  removeOnComplete: true,
  removeOnFail: true,
};

/** Grava a mensagem em campaign_sends e a põe na fila do canal. */
async function registrarEEnfileirar(args: {
  inviteId: string;
  contactId: string;
  channel: CanalDeConvite;
  address: string;
  kind: SurveyMessageKind;
}): Promise<void> {
  const [criado] = await getDb()
    .insert(campaignSends)
    .values({
      campaignId: null,
      surveyInviteId: args.inviteId,
      surveyMessageKind: args.kind,
      channel: args.channel,
      contactId: args.contactId,
      address: args.address,
    })
    .returning({ id: campaignSends.id });
  // WhatsApp entra na parte 5 (linha da Expansão); hoje só o e-mail é aceito.
  await getEmailQueue().add(
    "send-email",
    { sendId: criado.id, campaignId: null, contactId: args.contactId },
    { ...OPCOES_DO_JOB, jobId: `pesq__${criado.id}` }
  );
}

/** Parceiros (não leads) das listas e dos ids, sem repetição. */
async function parceirosDe(contactIds: string[], listIds: string[]): Promise<string[]> {
  const db = getDb();
  const ids = new Set<string>();
  if (listIds.length > 0) {
    const rows = await db
      .selectDistinct({ id: contacts.id })
      .from(contactLists)
      .innerJoin(contacts, eq(contacts.id, contactLists.contactId))
      .where(and(inArray(contactLists.listId, listIds), naoEhLead()));
    rows.forEach((r) => ids.add(r.id));
  }
  if (contactIds.length > 0) {
    const rows = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(inArray(contacts.id, contactIds), naoEhLead()));
    rows.forEach((r) => ids.add(r.id));
  }
  return [...ids];
}

export interface ResultadoConvite {
  convidados: number;
  /** Já tinham convite em aberto nesta pesquisa. */
  jaConvidados: number;
  /** Convidados sem endereço que aceite o canal: ficam só com o link. */
  semEndereco: number;
  enfileirados: number;
}

export async function convidarParceiros(args: {
  surveyId: string;
  contactIds: string[];
  listIds: string[];
  canais: CanalDeConvite[];
  autor: { id: string; name: string } | null;
}): Promise<ResultadoConvite> {
  const db = getDb();
  const resultado: ResultadoConvite = { convidados: 0, jaConvidados: 0, semEndereco: 0, enfileirados: 0 };

  for (const contactId of await parceirosDe(args.contactIds, args.listIds)) {
    let convite: { id: string };
    try {
      convite = await criarConvite({ surveyId: args.surveyId, contactId, autor: args.autor });
    } catch (error) {
      if (ehViolacaoDeUnico(error, "survey_invites_aberto_idx")) {
        resultado.jaConvidados += 1;
        continue;
      }
      throw error;
    }
    resultado.convidados += 1;

    let algumCanal = false;
    for (const canal of args.canais) {
      if (canal !== "email") continue;
      const address = await enderecoParaEnvioUnico(db, "email", contactId);
      if (!address) continue;
      await registrarEEnfileirar({ inviteId: convite.id, contactId, channel: canal, address, kind: "invite" });
      resultado.enfileirados += 1;
      algumCanal = true;
    }
    if (args.canais.length > 0 && !algumCanal) resultado.semEndereco += 1;
  }
  return resultado;
}

export async function limitesDeLembrete(): Promise<LimitesDeLembrete> {
  const [maximo, intervalo] = await Promise.all([
    getSetting(CHAVE_LEMBRETE_MAXIMO),
    getSetting(CHAVE_LEMBRETE_INTERVALO),
  ]);
  return lerLimites(maximo, intervalo);
}

export interface ResultadoLembrete {
  lembrados: number;
  pulados: Record<MotivoSemLembrete | "semEndereco", number>;
}

/** Lembra os convites escolhidos (ou todos os pendentes), dentro dos limites. */
export async function lembrarParceiros(args: {
  surveyId: string;
  inviteIds: string[] | "pendentes";
  canais: CanalDeConvite[];
}): Promise<ResultadoLembrete> {
  const db = getDb();
  const limites = await limitesDeLembrete();
  const resultado: ResultadoLembrete = {
    lembrados: 0,
    pulados: { concluido: 0, limite: 0, intervalo: 0, semEndereco: 0 },
  };

  const convites = await db
    .select({
      id: surveyInvites.id,
      contactId: surveyInvites.contactId,
      status: surveyInvites.status,
      remindersSent: surveyInvites.remindersSent,
      lastReminderAt: surveyInvites.lastReminderAt,
    })
    .from(surveyInvites)
    .where(
      args.inviteIds === "pendentes"
        ? and(
            eq(surveyInvites.surveyId, args.surveyId),
            inArray(surveyInvites.status, ["pending", "opened", "in_progress"])
          )
        : and(eq(surveyInvites.surveyId, args.surveyId), inArray(surveyInvites.id, args.inviteIds))
    );

  const agora = new Date();
  for (const c of convites) {
    const motivo = motivoSemLembrete(c, limites, agora);
    if (motivo) {
      resultado.pulados[motivo] += 1;
      continue;
    }
    let algumCanal = false;
    for (const canal of args.canais) {
      if (canal !== "email") continue;
      const address = await enderecoParaEnvioUnico(db, "email", c.contactId);
      if (!address) continue;
      await registrarEEnfileirar({ inviteId: c.id, contactId: c.contactId, channel: canal, address, kind: "reminder" });
      algumCanal = true;
    }
    if (!algumCanal) {
      resultado.pulados.semEndereco += 1;
      continue;
    }
    await db
      .update(surveyInvites)
      .set({ remindersSent: sql`${surveyInvites.remindersSent} + 1`, lastReminderAt: agora })
      .where(eq(surveyInvites.id, c.id));
    resultado.lembrados += 1;
  }
  return resultado;
}

type Resultado = { ok: true } | { ok: false; error: string };

async function conviteDaPesquisa(surveyId: string, inviteId: string) {
  const [c] = await getDb()
    .select({ id: surveyInvites.id, status: surveyInvites.status, contactId: surveyInvites.contactId })
    .from(surveyInvites)
    .where(and(eq(surveyInvites.id, inviteId), eq(surveyInvites.surveyId, surveyId)));
  return c ?? null;
}

/** Encerrar: o link deixa de aceitar resposta (não apaga o que já veio). */
export async function encerrarConvite(surveyId: string, inviteId: string): Promise<Resultado> {
  const c = await conviteDaPesquisa(surveyId, inviteId);
  if (!c) return { ok: false, error: "Convite não encontrado." };
  if (!estaPendente(c.status)) {
    return { ok: false, error: "Este convite já está concluído ou encerrado." };
  }
  await getDb()
    .update(surveyInvites)
    .set({ status: "closed", closedAt: new Date() })
    .where(eq(surveyInvites.id, inviteId));
  return { ok: true };
}

/** Reabrir: o parceiro volta a poder editar (decisão 3 do plano). */
export async function reabrirConvite(surveyId: string, inviteId: string): Promise<Resultado> {
  const c = await conviteDaPesquisa(surveyId, inviteId);
  if (!c) return { ok: false, error: "Convite não encontrado." };
  if (estaPendente(c.status)) return { ok: false, error: "Este convite já está aberto." };
  const db = getDb();
  // Volta para onde estava: "respondendo" se já há resposta, senão "abriu".
  const [{ respostas }] = await db
    .select({ respostas: sql<number>`count(*)`.mapWith(Number) })
    .from(surveyAnswers)
    .where(eq(surveyAnswers.inviteId, inviteId));
  try {
    await db
      .update(surveyInvites)
      .set({
        status: respostas > 0 ? "in_progress" : "opened",
        completedAt: null,
        closedAt: null,
      })
      .where(eq(surveyInvites.id, inviteId));
    return { ok: true };
  } catch (error) {
    if (ehViolacaoDeUnico(error, "survey_invites_aberto_idx")) {
      return {
        ok: false,
        error: "Este parceiro já tem outro convite em aberto nesta pesquisa (rodada nova).",
      };
    }
    throw error;
  }
}

export interface EmailDoConvite {
  subject: string;
  html: string;
  /** A caixa de quem convidou: a resposta do parceiro vai para ela. */
  replyTo: string | null;
}

export type MensagemMontada =
  | { ok: true; email: EmailDoConvite }
  | { ok: false; motivo: string };

/** O e-mail de um envio de pesquisa, montado na hora pelo worker. */
export async function montarEmailDoConvite(sendId: string): Promise<MensagemMontada> {
  const db = getDb();
  const [linha] = await db
    .select({
      kind: campaignSends.surveyMessageKind,
      inviteStatus: surveyInvites.status,
      token: surveyInvites.token,
      createdByUserId: surveyInvites.createdByUserId,
      surveyName: surveys.name,
      surveyStatus: surveys.status,
      emailSubject: surveys.emailSubject,
      emailBody: surveys.emailBody,
      contactName: contacts.name,
      company: contacts.company,
    })
    .from(campaignSends)
    .innerJoin(surveyInvites, eq(surveyInvites.id, campaignSends.surveyInviteId))
    .innerJoin(surveys, eq(surveys.id, surveyInvites.surveyId))
    .innerJoin(contacts, eq(contacts.id, surveyInvites.contactId))
    .where(eq(campaignSends.id, sendId));
  if (!linha) return { ok: false, motivo: "Envio sem convite de pesquisa." };
  if (!estaPendente(linha.inviteStatus)) {
    return { ok: false, motivo: "O convite já foi concluído ou encerrado." };
  }
  if (linha.surveyStatus !== "active") {
    return { ok: false, motivo: "A pesquisa não está mais ativa." };
  }

  const [autor] = linha.createdByUserId
    ? await db.select({ email: users.email }).from(users).where(eq(users.id, linha.createdByUserId))
    : [];

  const dados = { nome: linha.contactName, empresa: linha.company, pesquisa: linha.surveyName };
  const kind = linha.kind ?? "invite";
  return {
    ok: true,
    email: {
      subject: assuntoDaMensagem(
        preencherVariaveis(linha.emailSubject ?? assuntoPadrao(linha.surveyName), dados),
        kind
      ),
      html: htmlDaMensagem({
        corpo: preencherVariaveis(linha.emailBody ?? corpoPadrao(), dados),
        link: linkDoConvite(getBaseUrl(), linha.token),
        tipo: kind,
        nomeDaPesquisa: linha.surveyName,
      }),
      replyTo: autor?.email ?? null,
    },
  };
}

