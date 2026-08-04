import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import {
  contactEvents,
  contacts,
  getDb,
  leadScoreRules,
  type ContactEventType,
  type LeadScoreBand,
  type LeadScoreRule,
} from "@/lib/db";
import { emitContactEvent } from "@/lib/events";
import { getSetting, setSetting } from "@/lib/settings";

/**
 * Lead Score (docs/plano-webhooks-leads.md, seção 6).
 *
 * Duas decisões governam tudo aqui:
 *
 * 1. A pontuação é DERIVADA, nunca incrementada. Cada cálculo relê
 *    contact_events do zero. É o que faz mudar uma regra valer para o
 *    histórico inteiro, e não só dali para a frente — sem isso, corrigir um
 *    peso exigiria reprocessar a mão o que já passou.
 *
 * 2. Cada evento vale MENOS com o tempo. Sem decaimento todo lead antigo vira
 *    "quente" e o número perde sentido: quem abriu dez e-mails há um ano
 *    ficaria na frente de quem pediu demonstração ontem. A pergunta real é
 *    interesse ATUAL.
 */

/** Chaves de configuração — editáveis na tela, sem deploy. */
export const CHAVE_MEIA_VIDA = "lead_score_meia_vida_dias";
export const CHAVE_FAIXA_MORNO = "lead_score_faixa_morno";
export const CHAVE_FAIXA_QUENTE = "lead_score_faixa_quente";
/** Quando a passagem completa (a do decaimento) rodou pela última vez. */
export const CHAVE_ULTIMA_PASSAGEM = "lead_score_ultima_passagem";

export const PADRAO_MEIA_VIDA_DIAS = 30;
export const PADRAO_FAIXA_MORNO = 20;
export const PADRAO_FAIXA_QUENTE = 50;

/** Pontuação sugerida pelo plano — semeada na migração, editável depois. */
export const REGRAS_PADRAO: {
  eventType: ContactEventType;
  points: number;
  description: string;
}[] = [
  { eventType: "contact_created", points: 10, description: "Entrou como lead" },
  { eventType: "email_opened", points: 2, description: "Abriu um e-mail" },
  { eventType: "email_clicked", points: 5, description: "Clicou num e-mail" },
  {
    eventType: "whatsapp_replied",
    points: 15,
    description: "Respondeu no WhatsApp",
  },
  {
    eventType: "email_unsubscribed",
    points: -30,
    description: "Descadastrou-se do e-mail",
  },
  {
    eventType: "whatsapp_unsubscribed",
    points: -30,
    description: "Pediu para sair do WhatsApp",
  },
  { eventType: "tag_added", points: 1, description: "Ganhou uma tag" },
];

export interface Configuracao {
  meiaVidaDias: number;
  faixaMorno: number;
  faixaQuente: number;
}

export async function lerConfiguracao(): Promise<Configuracao> {
  const [meia, morno, quente] = await Promise.all([
    getSetting(CHAVE_MEIA_VIDA),
    getSetting(CHAVE_FAIXA_MORNO),
    getSetting(CHAVE_FAIXA_QUENTE),
  ]);
  return {
    meiaVidaDias: numero(meia, PADRAO_MEIA_VIDA_DIAS, 1),
    faixaMorno: numero(morno, PADRAO_FAIXA_MORNO, 0),
    faixaQuente: numero(quente, PADRAO_FAIXA_QUENTE, 1),
  };
}

function numero(valor: string | null, padrao: number, minimo: number): number {
  // O "ausente" precisa ser testado ANTES da conversão: `Number(null)` é 0, e
  // não NaN. Sem isto, uma chave nunca gravada virava 0 em vez do padrão — e
  // com faixaMorno = 0 todo lead ficava "morno", inclusive o de 4 pontos.
  if (valor === null || valor.trim() === "") return padrao;
  const n = Number(valor);
  return Number.isFinite(n) && n >= minimo ? n : padrao;
}

export function faixaDoScore(score: number, config: Configuracao): LeadScoreBand {
  if (score >= config.faixaQuente) return "quente";
  if (score >= config.faixaMorno) return "morno";
  return "frio";
}

/** Um evento já pontuado — é o que abre a conta na ficha do lead. */
export interface LinhaDaConta {
  tipo: ContactEventType;
  descricao: string;
  quando: Date;
  pontosOriginais: number;
  pontosHoje: number;
}

export interface ContaDoScore {
  score: number;
  faixa: LeadScoreBand;
  linhas: LinhaDaConta[];
}

/**
 * `pontos_hoje = pontos_da_regra × 0,5 ^ (idade_em_dias / meia_vida)`
 *
 * Um clique de hoje vale 5; o mesmo clique de 30 dias atrás vale 2,5; de 60
 * dias, 1,25.
 */
export function pontosComDecaimento(
  pontos: number,
  quando: Date,
  agora: Date,
  meiaVidaDias: number
): number {
  const idadeDias = Math.max(
    0,
    (agora.getTime() - quando.getTime()) / 86_400_000
  );
  return pontos * Math.pow(0.5, idadeDias / meiaVidaDias);
}

/**
 * A conta de um contato, aberta. Não grava nada — serve tanto ao recálculo
 * quanto à tela que responde "por que ele tem 47 pontos".
 */
export async function calcularConta(
  contactId: string,
  regras: LeadScoreRule[],
  config: Configuracao,
  agora = new Date()
): Promise<ContaDoScore> {
  const db = getDb();
  const ativas = new Map(
    regras.filter((r) => r.active).map((r) => [r.eventType, r])
  );

  if (ativas.size === 0) {
    return { score: 0, faixa: faixaDoScore(0, config), linhas: [] };
  }

  const eventos = await db
    .select({
      type: contactEvents.type,
      createdAt: contactEvents.createdAt,
    })
    .from(contactEvents)
    .where(
      and(
        eq(contactEvents.contactId, contactId),
        inArray(contactEvents.type, [...ativas.keys()])
      )
    )
    .orderBy(asc(contactEvents.createdAt));

  const linhas: LinhaDaConta[] = [];
  let total = 0;

  for (const evento of eventos) {
    const regra = ativas.get(evento.type);
    if (!regra) continue;
    const pontosHoje = pontosComDecaimento(
      regra.points,
      evento.createdAt,
      agora,
      config.meiaVidaDias
    );
    total += pontosHoje;
    linhas.push({
      tipo: evento.type,
      descricao: regra.description ?? evento.type,
      quando: evento.createdAt,
      pontosOriginais: regra.points,
      pontosHoje: Math.round(pontosHoje * 10) / 10,
    });
  }

  const score = Math.round(total);
  return {
    score,
    faixa: faixaDoScore(score, config),
    // Mais recente primeiro: é o que interessa na ficha.
    linhas: linhas.reverse(),
  };
}

export async function lerRegras(): Promise<LeadScoreRule[]> {
  return getDb().select().from(leadScoreRules);
}

/**
 * Recalcula e grava. Só a mudança de FAIXA vira evento — o número oscila a
 * cada passagem por causa do decaimento, e registrar toda variação encheria a
 * linha do tempo sem dizer nada.
 */
export async function recalcularContato(
  contactId: string,
  regras: LeadScoreRule[],
  config: Configuracao,
  agora = new Date()
): Promise<{ score: number; faixa: LeadScoreBand; mudouDeFaixa: boolean }> {
  const db = getDb();
  const [antes] = await db
    .select({ faixa: contacts.leadScoreBand })
    .from(contacts)
    .where(eq(contacts.id, contactId));

  const conta = await calcularConta(contactId, regras, config, agora);

  await db
    .update(contacts)
    .set({
      leadScore: conta.score,
      leadScoreBand: conta.faixa,
      leadScoreAt: agora,
    })
    .where(eq(contacts.id, contactId));

  const mudouDeFaixa = Boolean(antes) && antes.faixa !== conta.faixa;
  if (mudouDeFaixa) {
    await emitContactEvent("lead_score_changed", contactId, {
      de: antes.faixa,
      para: conta.faixa,
      score: conta.score,
    });
  }

  return { score: conta.score, faixa: conta.faixa, mudouDeFaixa };
}

/**
 * Leads com evento novo desde o último cálculo. É o gatilho barato: roda a
 * cada ciclo do worker e só toca em quem mudou.
 *
 * A comparação ignora eventos SEM regra ativa — inclusive o próprio
 * `lead_score_changed`, que senão pediria um recálculo a cada recálculo.
 */
export async function recalcularPendentes(limite = 200): Promise<number> {
  const db = getDb();
  const regras = await lerRegras();
  const ativas = regras.filter((r) => r.active).map((r) => r.eventType);
  if (ativas.length === 0) return 0;

  const config = await lerConfiguracao();

  const pendentes = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        isNotNull(contacts.stage),
        or(
          isNull(contacts.leadScoreAt),
          sql`EXISTS (
            SELECT 1 FROM ${contactEvents}
             WHERE ${contactEvents.contactId} = ${contacts.id}
               AND ${inArray(contactEvents.type, ativas)}
               AND ${contactEvents.createdAt} > ${contacts.leadScoreAt}
          )`
        )
      )
    )
    .limit(limite);

  const agora = new Date();
  for (const p of pendentes) {
    await recalcularContato(p.id, regras, config, agora);
  }
  return pendentes.length;
}

/**
 * Passagem completa sobre os leads — é ela que aplica o DECAIMENTO em quem não
 * teve evento novo. Sem isto, um lead parado congelaria no número do dia em
 * que foi calculado pela última vez.
 *
 * Roda no máximo uma vez por dia, controlada por app_settings em vez de cron:
 * sobrevive a restart e não depende de nada fora do worker.
 */
export async function passagemDiaria(
  intervaloHoras = 20
): Promise<{ rodou: boolean; recalculados: number }> {
  const ultima = await getSetting(CHAVE_ULTIMA_PASSAGEM);
  const agora = new Date();
  if (ultima) {
    const horas = (agora.getTime() - new Date(ultima).getTime()) / 3_600_000;
    if (Number.isFinite(horas) && horas < intervaloHoras) {
      return { rodou: false, recalculados: 0 };
    }
  }

  const db = getDb();
  const regras = await lerRegras();
  const config = await lerConfiguracao();

  const leads = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(isNotNull(contacts.stage));

  for (const lead of leads) {
    await recalcularContato(lead.id, regras, config, agora);
  }

  await setSetting(CHAVE_ULTIMA_PASSAGEM, agora.toISOString());
  return { rodou: true, recalculados: leads.length };
}

/** Recálculo de todos, agora — usado quando as regras mudam na tela. */
export async function recalcularTodos(): Promise<number> {
  const db = getDb();
  const regras = await lerRegras();
  const config = await lerConfiguracao();
  const agora = new Date();

  const leads = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(isNotNull(contacts.stage));

  for (const lead of leads) {
    await recalcularContato(lead.id, regras, config, agora);
  }
  return leads.length;
}
