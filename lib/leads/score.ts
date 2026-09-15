import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { casaGatilho } from "@/lib/automations/gatilho";
import { ETAPA_DE_ENTRADA } from "@/components/leads/estagios";
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
export const CHAVE_FAIXA_AQUECIDO = "lead_score_faixa_aquecido";
export const CHAVE_FAIXA_QUENTE = "lead_score_faixa_quente";
/** Quando a passagem completa (a do decaimento) rodou pela última vez. */
export const CHAVE_ULTIMA_PASSAGEM = "lead_score_ultima_passagem";
/** Com qual versão da REGRA de cálculo a base foi pontuada por último. */
export const CHAVE_VERSAO_DO_CALCULO = "lead_score_versao_do_calculo";

/**
 * Muda quando muda a REGRA de cálculo — não os pesos, que a tela de Pontuação
 * já recalcula na hora. A primeira passagem de um worker com versão nova roda
 * completa sem esperar o intervalo: senão a regra nova conviveria com números
 * velhos até a madrugada, e o recálculo por evento não pega quem ficou parado.
 *
 * 14/09/2026: etapa e qualificação passaram a valer só a atual.
 */
export const VERSAO_DO_CALCULO = "2026-09-14-estado-atual";

export const PADRAO_MEIA_VIDA_DIAS = 30;
export const PADRAO_FAIXA_MORNO = 20;
export const PADRAO_FAIXA_AQUECIDO = 50;
// "Quente" passou a ser o topo da escala quando a quarta faixa entrou. O 50 que
// antes era o limiar de quente virou o de AQUECIDO, e quente subiu para 100 —
// ver scripts/migrate-faixa-aquecido.ts, que move o valor já configurado.
export const PADRAO_FAIXA_QUENTE = 100;

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
  // ── Fase E.3: a rede que trouxe a pessoa ────────────────────────────
  //
  // `fonte` é a chave normalizada que a rota de coleta e o webhook gravam no
  // payload (lib/leads/fonte.ts): "Instagram", "ig" e "l.instagram.com" viram
  // `instagram`. A regra com condição vence o curinga do mesmo tipo — a visita
  // vinda do Instagram vale 6, e não 6 + 3. Os números aqui são os do plano
  // intocado; a migração (scripts/migrate-score-fonte-social.ts) semeia como
  // BÔNUS sobre o curinga que estiver no banco (+3 na visita, +5 na entrada),
  // porque em produção o curinga da visita já foi subido na tela.
  {
    eventType: "site_visited",
    points: 6,
    description: "Visitou o site vindo do Instagram",
    condition: { fonte: "instagram" },
  },
  {
    eventType: "site_visited",
    points: 6,
    description: "Visitou o site vindo do Facebook",
    condition: { fonte: "facebook" },
  },
  {
    eventType: "contact_created",
    points: 15,
    description: "Entrou como lead pelo Instagram",
    condition: { fonte: "instagram" },
  },
  {
    eventType: "contact_created",
    points: 15,
    description: "Entrou como lead pelo Facebook",
    condition: { fonte: "facebook" },
  },
];

export interface Configuracao {
  meiaVidaDias: number;
  faixaMorno: number;
  faixaAquecido: number;
  faixaQuente: number;
}

export async function lerConfiguracao(): Promise<Configuracao> {
  const [meia, morno, aquecido, quente] = await Promise.all([
    getSetting(CHAVE_MEIA_VIDA),
    getSetting(CHAVE_FAIXA_MORNO),
    getSetting(CHAVE_FAIXA_AQUECIDO),
    getSetting(CHAVE_FAIXA_QUENTE),
  ]);
  return {
    meiaVidaDias: numero(meia, PADRAO_MEIA_VIDA_DIAS, 1),
    faixaMorno: numero(morno, PADRAO_FAIXA_MORNO, 0),
    faixaAquecido: numero(aquecido, PADRAO_FAIXA_AQUECIDO, 1),
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
  if (score >= config.faixaAquecido) return "aquecido";
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

/** Um evento como a conta o enxerga. */
export interface EventoPontuavel {
  type: ContactEventType;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

/** O que o contato carrega de estado — a fonte de quem não tem evento. */
export interface EstadoDoContato {
  stage: string | null;
  stageChangedAt: Date | null;
  qualification: string | null;
  qualifiedAt: Date | null;
  /** Quando ele entrou: a data de quem não tem outra. */
  desde: Date;
}

/**
 * Tipos que descrevem ESTADO, e não ação: onde o lead está no funil e como o
 * comercial o qualificou. De cada um vale só o mais recente.
 *
 * Somados como as ações, eles pontuariam a TRAJETÓRIA em vez da posição. Quem
 * andou etapa por etapa até a proposta juntaria os pontos de todas; quem o
 * vendedor arrastou direto para lá — ou que a sincronização, de 5 em 5
 * minutos, só viu chegando — teria só os da última: a mesma posição valendo
 * números diferentes. E o lead qualificado como "Experiente" e depois como
 * "Não" seguiria com os pontos de experiente.
 */
const TIPOS_DE_ESTADO: ReadonlySet<ContactEventType> = new Set([
  "lead_stage_changed",
  "lead_qualified",
]);

/**
 * Os eventos que entram na conta: todas as ações e, de cada estado, só o
 * vigente. Pura — a regra de "o que conta" é testada sem banco.
 *
 * `eventos` em ordem cronológica; a devolução também.
 */
export function eventosQueContam(
  eventos: EventoPontuavel[],
  estado: EstadoDoContato
): EventoPontuavel[] {
  const vigentes = new Map<ContactEventType, EventoPontuavel>();

  // Do mais novo para o mais velho: o primeiro de cada tipo é o que vale.
  for (let i = eventos.length - 1; i >= 0; i--) {
    const evento = eventos[i];
    if (!TIPOS_DE_ESTADO.has(evento.type) || vigentes.has(evento.type)) {
      continue;
    }
    // A conversão em parceiro também é `lead_stage_changed`, com `para` nulo.
    // Ela tira o contato do funil, mas não apaga onde ele chegou: a ficha
    // congelada de quem comprou continua mostrando a etapa de compra.
    if (evento.type === "lead_stage_changed" && !evento.payload?.para) continue;
    vigentes.set(evento.type, evento);
  }

  // Sem evento, o estado vem do próprio contato. Acontece quando o webhook já
  // cria o lead numa etapa adiante: o contato nasce nela sem "andar" até ela.
  // A etapa de entrada fica de fora — quem nunca saiu dela não chegou a lugar
  // nenhum, e uma regra curinga de "andou no funil" pontuaria todo lead novo.
  if (
    !vigentes.has("lead_stage_changed") &&
    estado.stage &&
    estado.stage !== ETAPA_DE_ENTRADA
  ) {
    vigentes.set("lead_stage_changed", {
      type: "lead_stage_changed",
      payload: { para: estado.stage },
      createdAt: estado.stageChangedAt ?? estado.desde,
    });
  }
  if (!vigentes.has("lead_qualified") && estado.qualification) {
    vigentes.set("lead_qualified", {
      type: "lead_qualified",
      payload: { qualificacao: estado.qualification },
      createdAt: estado.qualifiedAt ?? estado.desde,
    });
  }

  return [
    ...eventos.filter((e) => !TIPOS_DE_ESTADO.has(e.type)),
    ...vigentes.values(),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * A conta de um contato, aberta. Não grava nada — serve tanto ao recálculo
 * quanto à tela que responde "por que ele tem 47 pontos".
 *
 * `estado` é opcional porque o recálculo já leu o contato; a tela não.
 */
export async function calcularConta(
  contactId: string,
  regras: LeadScoreRule[],
  config: Configuracao,
  agora = new Date(),
  estado?: EstadoDoContato
): Promise<ContaDoScore> {
  const db = getDb();
  const porTipo = agruparRegras(regras);

  if (porTipo.size === 0) {
    return { score: 0, faixa: faixaDoScore(0, config), linhas: [] };
  }

  const [eventos, estadoDoContato] = await Promise.all([
    db
      .select({
        type: contactEvents.type,
        // O payload entra na conta desde a fase E: é ele que distingue "viu a
        // página de preços" de "visitou o site", que são o mesmo tipo de
        // evento com pesos diferentes.
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
      .orderBy(asc(contactEvents.createdAt)),
    estado ?? lerEstado(contactId),
  ]);

  return montarConta(
    eventosQueContam(eventos, estadoDoContato ?? SEM_ESTADO),
    regras,
    config,
    agora
  );
}

/** Contato que não existe mais: só os eventos, sem estado de onde completar. */
const SEM_ESTADO: EstadoDoContato = {
  stage: null,
  stageChangedAt: null,
  qualification: null,
  qualifiedAt: null,
  desde: new Date(0),
};

const COLUNAS_DO_ESTADO = {
  stage: contacts.stage,
  stageChangedAt: contacts.stageChangedAt,
  qualification: contacts.qualification,
  qualifiedAt: contacts.qualifiedAt,
  acquiredAt: contacts.acquiredAt,
  createdAt: contacts.createdAt,
};

function paraEstado(linha: {
  stage: string | null;
  stageChangedAt: Date | null;
  qualification: string | null;
  qualifiedAt: Date | null;
  acquiredAt: Date | null;
  createdAt: Date;
}): EstadoDoContato {
  return {
    stage: linha.stage,
    stageChangedAt: linha.stageChangedAt,
    qualification: linha.qualification,
    qualifiedAt: linha.qualifiedAt,
    desde: linha.acquiredAt ?? linha.createdAt,
  };
}

async function lerEstado(contactId: string): Promise<EstadoDoContato | null> {
  const [linha] = await getDb()
    .select(COLUNAS_DO_ESTADO)
    .from(contacts)
    .where(eq(contacts.id, contactId));
  return linha ? paraEstado(linha) : null;
}

/** A soma, já com os eventos que contam. Pura. */
export function montarConta(
  eventos: EventoPontuavel[],
  regras: LeadScoreRule[],
  config: Configuracao,
  agora: Date
): ContaDoScore {
  const porTipo = agruparRegras(regras);
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
    .select({ faixa: contacts.leadScoreBand, ...COLUNAS_DO_ESTADO })
    .from(contacts)
    .where(eq(contacts.id, contactId));

  const conta = await calcularConta(
    contactId,
    regras,
    config,
    agora,
    antes ? paraEstado(antes) : undefined
  );

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
  const [ultima, versao] = await Promise.all([
    getSetting(CHAVE_ULTIMA_PASSAGEM),
    getSetting(CHAVE_VERSAO_DO_CALCULO),
  ]);
  const agora = new Date();
  // Regra de cálculo nova: passa já, sem esperar o intervalo.
  const calculoMudou = versao !== VERSAO_DO_CALCULO;
  if (ultima && !calculoMudou) {
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
  if (calculoMudou) await setSetting(CHAVE_VERSAO_DO_CALCULO, VERSAO_DO_CALCULO);
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
