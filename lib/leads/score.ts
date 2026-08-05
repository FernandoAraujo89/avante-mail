import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { casaGatilho } from "@/lib/automations/engine";
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

/**
 * Pontuação sugerida pelo plano — semeada na migração, editável depois.
 *
 * `condition` casa contra o payload do evento (mesma semântica do gatilho de
 * automação). É o que permite dois pesos para o mesmo `site_event`.
 */
export const REGRAS_PADRAO: {
  eventType: ContactEventType;
  points: number;
  description: string;
  condition?: Record<string, unknown>;
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
  // ── Fase E: rastreio do site ────────────────────────────────────────
  //
  // Os nomes descrevem o que existe em avantejuntos.com.br. O plano sugeria
  // "viu a página de preços" e "pediu demonstração", mas o site não tem
  // nenhuma das duas — seriam regras que jamais disparariam. As páginas reais
  // ficam em site_event_rules, editáveis em /leads/rastreio.
  { eventType: "site_visited", points: 3, description: "Visitou o site" },
  {
    eventType: "site_event",
    points: 10,
    description: "Pesquisou produto no site",
    condition: { evento: "produto" },
  },
  {
    eventType: "site_event",
    points: 25,
    description: "Pediu contato no site",
    condition: { evento: "contato" },
  },
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

/**
 * Regras ativas agrupadas por tipo de evento, com as MAIS ESPECÍFICAS na
 * frente.
 *
 * O agrupamento existe porque desde a fase E um mesmo tipo tem várias regras:
 * `site_event` vale +10 para `{"evento":"precos"}` e +25 para
 * `{"evento":"demo"}`. Até a fase C isto era um `Map` por tipo — e `new Map()`
 * com chave repetida guarda SILENCIOSAMENTE a última: a segunda regra sumiria
 * da conta sem erro, sem log e sem sintoma na tela, deixando só um número
 * errado. Por isso o agrupamento e a queda do UNIQUE de `event_type` andam
 * juntos, na mesma migração.
 */
function agruparRegras(
  regras: LeadScoreRule[]
): Map<ContactEventType, LeadScoreRule[]> {
  const porTipo = new Map<ContactEventType, LeadScoreRule[]>();
  for (const regra of regras) {
    if (!regra.active) continue;
    const lista = porTipo.get(regra.eventType) ?? [];
    lista.push(regra);
    porTipo.set(regra.eventType, lista);
  }
  for (const lista of porTipo.values()) {
    lista.sort((a, b) => {
      // Com condição primeiro: a regra específica precisa vencer o curinga.
      const especificidade =
        Number(Boolean(b.condition)) - Number(Boolean(a.condition));
      if (especificidade !== 0) return especificidade;
      // Empate entre duas regras de mesma especificidade: desempata por peso e
      // depois por id. Sem isto, a vencedora seria a ordem em que o Postgres
      // devolveu as linhas — e a pontuação da mesma pessoa poderia mudar entre
      // dois recálculos sem nada ter mudado.
      if (b.points !== a.points) return b.points - a.points;
      return a.id.localeCompare(b.id);
    });
  }
  return porTipo;
}

/**
 * A regra que vale para um evento: a PRIMEIRA que casa, nunca a soma.
 *
 * Somar seria pior de duas formas. A conta deixaria de ser explicável — um
 * evento de demonstração valeria 25 + 3 = 28 e ninguém saberia de onde saiu o
 * 28, o que mata o propósito do card de conta aberta. E o curinga viraria um
 * piso invisível em cima de todo evento nomeado.
 */
function regraQueCasa(
  candidatas: LeadScoreRule[] | undefined,
  payload: Record<string, unknown> | null
): LeadScoreRule | null {
  if (!candidatas) return null;
  for (const regra of candidatas) {
    // Mesma semântica do gatilho de automação (lib/automations/engine.ts):
    // sem condição casa com tudo; com condição, todas as chaves precisam bater.
    if (casaGatilho(regra.condition ?? null, payload)) return regra;
  }
  return null;
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
  const porTipo = agruparRegras(regras);

  if (porTipo.size === 0) {
    return { score: 0, faixa: faixaDoScore(0, config), linhas: [] };
  }

  const eventos = await db
    .select({
      type: contactEvents.type,
      // O payload entra na conta desde a fase E: é ele que distingue "viu a
      // página de preços" de "visitou o site", que são o mesmo tipo de evento
      // com pesos diferentes.
      payload: contactEvents.payload,
      createdAt: contactEvents.createdAt,
    })
    .from(contactEvents)
    .where(
      and(
        eq(contactEvents.contactId, contactId),
        inArray(contactEvents.type, [...porTipo.keys()])
      )
    )
    .orderBy(asc(contactEvents.createdAt));

  const linhas: LinhaDaConta[] = [];
  let total = 0;

  for (const evento of eventos) {
    const regra = regraQueCasa(porTipo.get(evento.type), evento.payload);
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
  // DISTINTOS: desde a fase E o mesmo tipo tem várias regras (uma por evento
  // nomeado), e repetir o tipo aqui só incharia o IN da consulta.
  const ativas = [
    ...new Set(regras.filter((r) => r.active).map((r) => r.eventType)),
  ];
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
