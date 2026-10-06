import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { EmailDesign, EditorType, Row } from "../email-builder/types";
import type { Perfil } from "../perfis";
import type {
  WhatsAppButton,
  WhatsAppHeaderType,
  WhatsAppTemplateCategory,
  WhatsAppTemplateStatus,
  WhatsAppVariableExamples,
  WhatsAppVariableMap,
} from "../whatsapp/types";

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

// Canal de envio da campanha. E-mail é o padrão histórico.
export const CAMPAIGN_CHANNELS = ["email", "whatsapp", "sms"] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

/**
 * Canal vindo do corpo de uma requisição. Desconhecido vira "email" — o
 * padrão histórico e o único canal que sempre existiu.
 *
 * Existe como função, e não como o ternário que estava espalhado pelas rotas,
 * porque o ternário fechado (`x === "whatsapp" ? "whatsapp" : "email"`) tinha
 * um efeito silencioso e caro: quando o SMS entrou em CAMPAIGN_CHANNELS, uma
 * campanha de SMS era salva como e-mail sem nenhum aviso. Aqui, um canal novo
 * na lista acima passa a ser aceito em todas as rotas de uma vez.
 */
export function parseCampaignChannel(value: unknown): CampaignChannel {
  return CAMPAIGN_CHANNELS.includes(value as CampaignChannel)
    ? (value as CampaignChannel)
    : "email";
}

// Tipo do envio. O Avante News é o boletim semanal dos parceiros White Label:
// usa a mesma máquina de envio das campanhas, mas é registrado e reportado
// separadamente (nunca aparece junto das campanhas).
export const CAMPAIGN_KINDS = ["campaign", "news"] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

export const SEND_STATUSES = [
  "pending",
  "sent",
  "failed",
  "opened",
  "clicked",
  "bounced",
  // Confirmações exclusivas do canal WhatsApp (webhook da Cloud API).
  "delivered",
  "read",
] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];

// Tipo de devolução reportado pelo Resend/SES.
export const BOUNCE_TYPES = ["hard", "soft"] as const;
export type BounceType = (typeof BOUNCE_TYPES)[number];

/**
 * A ETAPA do lead espelha o funil do **Pipedrive** e chega por webhook — o
 * agente que conversa com o lead acompanha o funil lá e nos avisa quando ele
 * anda ("passou por apresentação de produto", "comprou").
 *
 * Por isso NÃO existe uma lista de etapas no código: o funil é do Pipedrive,
 * muda quando o comercial quiser, e uma constante aqui exigiria deploy a cada
 * mudança de processo alheio. As etapas vivem na tabela `lead_stages`, e
 * `contacts.stage` guarda o slug de uma delas.
 *
 * A QUALIFICAÇÃO (logo abaixo) é outra coisa: é vocabulário nosso, do playbook
 * do SDR, e por isso mora no código.
 */

/**
 * A QUALIFICAÇÃO seguia o mesmo destino que as etapas: começou como constante
 * de código ("vocabulário nosso, do playbook") até o campo "Lead qualificado"
 * do Pipedrive ganhar opções que o código não conhecia — e toda entrega do
 * agente com elas era recusada. Hoje ela espelha aquele campo e vive na tabela
 * `lead_qualifications`, editável em /leads/qualificacoes, pela mesma razão
 * das etapas: a lista é do comercial, e não pode depender de deploy nosso.
 */

// Natureza da lista. Nulo = lista comum (parceiros). "leads" marca a lista de
// leads, e é o que as travas contra disparo acidental consultam — o nome
// "Leads" pode ser renomeado, a marca não.
export const LIST_KINDS = ["leads"] as const;
export type ListKind = (typeof LIST_KINDS)[number];

// O que acontece com um contato. É a matéria-prima dos gatilhos das
// automações (docs/plano-automacoes.md): sem isto o sistema só conhece o
// ESTADO das tags, nunca a MUDANÇA — e "quando a tag X for adicionada"
// depende exatamente da mudança.
export const CONTACT_EVENT_TYPES = [
  "contact_created",
  "tag_added",
  "tag_removed",
  "list_subscribed",
  "list_unsubscribed",
  "email_unsubscribed",
  "email_opened",
  "email_clicked",
  "whatsapp_replied",
  "whatsapp_unsubscribed",
  // Canal SMS (Twilio): resposta recebida no inbound e opt-out por palavra
  // (PARAR/SAIR/…) ou pelo erro 21610/21614 no status callback. Mesma lógica
  // dos análogos de WhatsApp — o motor de automações ignora tipos que nenhum
  // gatilho declara, então adicionar não mexe em fluxo em produção.
  "sms_replied",
  "sms_unsubscribed",
  // Movimentação do lead no funil, feita na área de Leads. Fica registrado
  // aqui para a linha do tempo da ficha e para o Lead Score (fase C) — o motor
  // de automações ignora o que nenhum gatilho declara, então adicionar o tipo
  // não mexe em nenhum fluxo em produção.
  "lead_stage_changed",
  // O agente qualificou o lead (playbook do SDR). Vira evento porque é a
  // matéria-prima de duas coisas: pontuar quem chega mais maduro, e disparar a
  // trilha de nutrição certa para cada perfil.
  "lead_qualified",
  // Mudança de FAIXA do Lead Score (frio→morno→quente). Só a virada de faixa
  // vira evento — o número muda o tempo todo pelo decaimento, e registrar cada
  // variação encheria a linha do tempo de ruído sem informar nada.
  "lead_score_changed",
  // Fase E — rastreio do site. `site_visited` é a sessão (uma por visita, não
  // por página); `site_event` é um ato nomeado ("viu preços", "pediu demo").
  // Nenhum dos dois entra em AUTOMATION_TRIGGER_TYPES nesta fase: gatilho
  // ligado a endpoint público dispara passo de envio, e passo de envio custa
  // dinheiro. O motor ignora o que nenhum gatilho declara.
  "site_visited",
  "site_event",
] as const;
export type ContactEventType = (typeof CONTACT_EVENT_TYPES)[number];

// Faixas do Lead Score. Os limites são configuráveis (app_settings); os nomes,
// não — eles são a linguagem que a equipe usa.
export const LEAD_SCORE_BANDS = [
  "frio",
  "morno",
  "aquecido",
  "quente",
] as const;
export type LeadScoreBand = (typeof LEAD_SCORE_BANDS)[number];

// Usuários do sistema (login próprio).
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Perfil de acesso (lib/perfis.ts). Quem já existia é admin.
  role: text("role").$type<Perfil>().notNull().default("admin"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Tokens de redefinição de senha ("Esqueci minha senha").
// Guarda só o SHA-256 do token — o token cru vai apenas no link do e-mail.
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Um contato pode ter VÁRIOS e-mails e VÁRIOS telefones (contact_emails e
// contact_phones, logo abaixo), e a campanha vai para todos. As colunas de
// endereço e de consentimento DESTA tabela são um RESUMO dos endereços,
// mantido por lib/contatos/enderecos.ts:
//   email / phone                         = o endereço principal;
//   subscribed / whatsappSubscribed / sms = ALGUM endereço aceita o canal;
//   *OptInAt                              = o primeiro aceite;
//   *OptOutAt                             = quando o ÚLTIMO endereço saiu
//                                           (nulo enquanto algum aceita).
// É o que deixa as telas, os filtros e as condições de automação lerem o
// contato como sempre leram. Quem ESCREVE endereço ou consentimento passa
// pelo módulo; escrever direto aqui deixa o resumo mentindo.
export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Nulo = contato só com telefone. Quando existe, é único: um e-mail
  // pertence a um contato só.
  email: text("email").unique(),
  company: text("company"),
  tags: text("tags").array(),
  subscribed: boolean("subscribed").notNull().default(true),
  // Quando o e-mail foi SUPRIMIDO: a pessoa pediu para sair, a devolução foi
  // definitiva, ou houve reclamação de spam. Existe para separar dois estados
  // que `subscribed = false` confundia:
  //   preenchido → não pode mais receber; automação em curso PARA;
  //   nulo       → apenas nunca deu aceite (lead novo). A automação segue, e
  //                é o passo de envio que recusa.
  // Sem essa distinção, nenhum lead poderia ser nutrido.
  emailOptOutAt: timestamp("email_opt_out_at", { withTimezone: true }),
  // Canal WhatsApp: telefone em E.164 (+5548…) e consentimento próprio, separado
  // do de e-mail (subscribed) — exigência da política da Meta e da LGPD.
  // O padrão do PRODUTO é "sim": cadastro e importação já marcam o opt-in de
  // quem tem telefone, e só um "não" explícito o remove (ver as rotas de
  // contatos). O default da COLUNA continua false de propósito: é a rede de
  // segurança para qualquer insert que não declare consentimento.
  phone: text("phone").unique(),
  whatsappSubscribed: boolean("whatsapp_subscribed").notNull().default(false),
  whatsappOptInAt: timestamp("whatsapp_opt_in_at", { withTimezone: true }),
  whatsappOptOutAt: timestamp("whatsapp_opt_out_at", { withTimezone: true }),
  // Canal SMS: consentimento próprio, separado do e-mail e do WhatsApp — a
  // LGPD trata cada canal como um aceite. Mesmo telefone do WhatsApp, mas o
  // opt-out de um canal NÃO derruba o outro: quem respondeu SAIR no WhatsApp
  // pode continuar aceitando SMS, e vice-versa. `smsOptOutAt` preenchido
  // também cobre o número inválido/fixo (erro 21614 da Twilio): o significado
  // operacional é o mesmo — não gastar mais dinheiro tentando.
  smsSubscribed: boolean("sms_subscribed").notNull().default(false),
  smsOptInAt: timestamp("sms_opt_in_at", { withTimezone: true }),
  smsOptOutAt: timestamp("sms_opt_out_at", { withTimezone: true }),

  // ── Lead (docs/plano-webhooks-leads.md) ──────────────────────────────
  // Nulo = não é lead; é parceiro/contato comum. A separação operacional é
  // feita pela LISTA "Leads"; este campo é a ETAPA do funil do Pipedrive,
  // espelhada por webhook. Sem `$type` de propósito: as etapas são dado
  // (tabela `lead_stages`), não constante de código.
  stage: text("stage"),
  /** Quando a etapa mudou pela última vez. */
  stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }),

  // Qualificação dada pelo agente. Slug de `lead_qualifications` — dado, não
  // constante, pelo mesmo motivo do `stage` logo acima.
  qualification: text("qualification"),
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),

  // Origem do PRIMEIRO contato. Gravada uma vez e NÃO sobrescrita: quem chegou
  // pelo Instagram e voltou meses depois pelo Google continua sendo do
  // Instagram — é isso que responde "qual canal traz lead". As visitas
  // seguintes viram pontos de contato em contact_events.
  sourceChannel: text("source_channel"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmTerm: text("utm_term"),
  landingPage: text("landing_page"),
  referrer: text("referrer"),
  /** Nome do cenário/formulário que enviou. */
  sourceDetail: text("source_detail"),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }),

  // Lead Score. É DERIVADO de contact_events — nunca incrementado às cegas —,
  // então mudar uma regra vale para o histórico inteiro e não só dali para a
  // frente. `leadScoreAt` marca quando a conta foi feita: é o que diz ao
  // worker quem precisa ser recalculado.
  leadScore: integer("lead_score"),
  leadScoreBand: text("lead_score_band").$type<LeadScoreBand>(),
  leadScoreAt: timestamp("lead_score_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Endereços do contato ──────────────────────────────────────────────────
// O consentimento mora AQUI, por endereço: o SAIR chega de UM número e o
// descadastro vem do link de UM e-mail. Tirar a pessoa inteira silenciaria um
// número que ela ainda queria (decisão de 06/10/2026). O resumo em `contacts`
// é derivado destas linhas.

export const contactPhones = pgTable(
  "contact_phones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    // E.164 (+5548…). Um número pertence a UM contato.
    phone: text("phone").notNull().unique(),
    whatsappSubscribed: boolean("whatsapp_subscribed").notNull().default(false),
    whatsappOptInAt: timestamp("whatsapp_opt_in_at", { withTimezone: true }),
    whatsappOptOutAt: timestamp("whatsapp_opt_out_at", { withTimezone: true }),
    smsSubscribed: boolean("sms_subscribed").notNull().default(false),
    smsOptInAt: timestamp("sms_opt_in_at", { withTimezone: true }),
    smsOptOutAt: timestamp("sms_opt_out_at", { withTimezone: true }),
    // O que aparece como "o telefone" do contato. Um por contato.
    principal: boolean("principal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("contact_phones_contato_idx").on(t.contactId),
    uniqueIndex("contact_phones_principal_idx")
      .on(t.contactId)
      .where(sql`${t.principal}`),
  ]
);

export const contactEmails = pgTable(
  "contact_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    // Minúsculo. Um e-mail pertence a UM contato.
    email: text("email").notNull().unique(),
    subscribed: boolean("subscribed").notNull().default(true),
    // Preenchido = este endereço pediu para sair (ou devolveu/reclamou).
    optOutAt: timestamp("opt_out_at", { withTimezone: true }),
    principal: boolean("principal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("contact_emails_contato_idx").on(t.contactId),
    uniqueIndex("contact_emails_principal_idx")
      .on(t.contactId)
      .where(sql`${t.principal}`),
  ]
);

// Listas de contato criadas pelo usuário (substituem os antigos segmentos).
export const lists = pgTable("lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  // Nulo = lista de parceiros. "leads" = destino da entrada por webhook, e a
  // única lista onde um lead pode cair (docs/plano-webhooks-leads.md, seção 5).
  kind: text("kind").$type<ListKind>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Pedido de campanha feito por quem não dispara (o Sucesso do cliente): diz o
// canal, as listas e o que comunicar. Quem cria e dispara a campanha é sempre
// o marketing (admin). As listas ficam como ids soltos, sem FK: o pedido é um
// registro histórico e não deve sumir porque uma lista foi apagada.
export const CAMPAIGN_REQUEST_STATUSES = [
  "pendente",
  "em_andamento",
  "concluida",
  "recusada",
] as const;
export type CampaignRequestStatus = (typeof CAMPAIGN_REQUEST_STATUSES)[number];
export const CAMPAIGN_REQUEST_CHANNELS = ["email", "whatsapp"] as const;
export type CampaignRequestChannel = (typeof CAMPAIGN_REQUEST_CHANNELS)[number];

export const campaignRequests = pgTable("campaign_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  channels: text("channels").array().$type<CampaignRequestChannel[]>().notNull(),
  listIds: uuid("list_ids").array().notNull(),
  briefing: text("briefing").notNull(),
  /** Quando a pessoa gostaria que saísse. Nulo = sem data. */
  desiredAt: timestamp("desired_at", { withTimezone: true }),
  status: text("status")
    .$type<CampaignRequestStatus>()
    .notNull()
    .default("pendente"),
  /** Resposta do marketing (motivo da recusa, combinado de data…). */
  responseNote: text("response_note"),
  requestedBy: uuid("requested_by").references(() => users.id, {
    onDelete: "set null",
  }),
  handledBy: uuid("handled_by").references(() => users.id, {
    onDelete: "set null",
  }),
  /** Campanha criada a partir do pedido (a primeira, se forem dois canais). */
  campaignId: uuid("campaign_id").references(() => campaigns.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Associação N:N — um contato pode estar em várias listas e vice-versa.
export const contactLists = pgTable(
  "contact_lists",
  {
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.listId] })]
);

// Fila de eventos do contato (padrão outbox) — o que alimenta os gatilhos das
// automações. É gravado na mesma operação que muda o contato, ANTES de ser
// processado: assim um gatilho com defeito pode ser corrigido e os eventos
// reprocessados, sem ter perdido nada no caminho.
// processedAt nulo = ainda não consumido. Enquanto o motor de automações não
// existir, todos ficam nulos — o registro já começa a acumular histórico.
export const contactEvents = pgTable(
  "contact_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    type: text("type").$type<ContactEventType>().notNull(),
    /** Detalhe do evento: { tag }, { listId }, { campaignId, sendId }… */
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    // O motor varre os pendentes em ordem de chegada.
    index("contact_events_pendentes_idx").on(t.processedAt, t.createdAt),
    index("contact_events_contato_idx").on(t.contactId, t.createdAt),
  ]
);

// ─── Automações ────────────────────────────────────────────────────────────
// Fluxo que roda sozinho por contato (docs/plano-automacoes.md).

export const AUTOMATION_STATUSES = ["draft", "active", "paused", "archived"] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const AUTOMATION_TRIGGER_TYPES = [
  "tag_added",
  "tag_removed",
  "list_subscribed",
  "list_unsubscribed",
  "contact_created",
  "email_opened",
  "email_clicked",
  "whatsapp_replied",
  // Fase F+ — o lead mudou de FAIXA de pontuação (frio/morno/quente). Só a
  // virada de faixa vira evento, nunca a variação do número, então este
  // gatilho não dispara a cada recálculo. E a reentrada é barrada pelo índice
  // único (automation_id, contact_id): um lead que oscile na fronteira da
  // faixa entra UMA vez, não a cada ida e volta.
  "lead_score_changed",
  // A etapa do funil mudou (webhook do agente, espelhando o Pipedrive). É o
  // que troca a trilha de nutrição quando o lead avança lá — "passou por
  // apresentação de produto" entra num fluxo diferente de quem nunca viu.
  "lead_stage_changed",
  // O agente qualificou o lead. Faz a nutrição começar pelo perfil certo.
  "lead_qualified",
  "manual",
] as const;
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

export const AUTOMATION_STEP_TYPES = [
  // Fase 1 — fluxo e ações sobre o contato
  "wait",
  "add_tag",
  "remove_tag",
  "subscribe_list",
  "unsubscribe_list",
  "end",
  // Fase 2 — envios
  "send_email",
  "send_whatsapp",
  // Fase 3 — ramificação
  "if_else",
  // Ainda não implementados; o motor recusa com mensagem clara.
  "update_field",
  "webhook",
] as const;
export type AutomationStepType = (typeof AUTOMATION_STEP_TYPES)[number];

export const AUTOMATION_RUN_STATUSES = [
  "running",
  "waiting",
  "done",
  "stopped",
  "failed",
] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export const automations = pgTable("automations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").$type<AutomationStatus>().notNull().default("draft"),
  /** Versão que recebe novas entradas. Quem já entrou segue a sua. */
  currentVersionId: uuid("current_version_id"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Editar uma automação em uso cria uma versão nova: quem já está no meio do
// fluxo termina pela versão em que entrou, senão receberia o passo 5 de um
// fluxo que não existe mais.
export const automationVersions = pgTable(
  "automation_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("automation_versions_idx").on(t.automationId, t.version)]
);

export const automationTriggers = pgTable(
  "automation_triggers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => automationVersions.id, { onDelete: "cascade" }),
    type: text("type").$type<AutomationTriggerType>().notNull(),
    /** { tag } | { listId } — o que o evento precisa casar. */
    config: jsonb("config").$type<Record<string, unknown>>(),
  },
  (t) => [index("automation_triggers_versao_idx").on(t.versionId, t.type)]
);

// Árvore do fluxo. parent + branch + position (em vez de ponteiro encadeado)
// porque a tela insere passos ENTRE dois existentes: com posição é só
// deslocar, com ponteiro seria reescrever vizinhos.
export const automationSteps = pgTable(
  "automation_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => automationVersions.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    /** Caminho do pai: 'main', ou 'yes'/'no' quando o pai é um Se/Então. */
    branch: text("branch").notNull().default("main"),
    position: integer("position").notNull().default(0),
    type: text("type").$type<AutomationStepType>().notNull(),
    config: jsonb("config").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("automation_steps_ordem_idx").on(t.versionId, t.parentId, t.branch, t.position),
  ]
);

// Um contato percorrendo o fluxo.
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => automationVersions.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    currentStepId: uuid("current_step_id"),
    status: text("status")
      .$type<AutomationRunStatus>()
      .notNull()
      .default("running"),
    /** Espelha o agendamento do BullMQ — ver a reconciliação no worker. */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    /** Teto contra laço infinito (automação que realimenta o próprio gatilho). */
    stepsExecuted: integer("steps_executed").notNull().default(0),
    stoppedReason: text("stopped_reason"),
    enteredAt: timestamp("entered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // Reentrada = não: um contato entra uma vez em cada automação. Este índice
    // é a própria trava contra evento repetido criar percurso duplicado.
    uniqueIndex("automation_runs_unico_idx").on(t.automationId, t.contactId),
    index("automation_runs_pendentes_idx").on(t.status, t.nextRunAt),
  ]
);

// Log por passo: auditoria e, mais tarde, as métricas por passo da tela.
export const automationRunSteps = pgTable(
  "automation_run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").notNull(),
    status: text("status").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("automation_run_steps_idx").on(t.runId, t.at)]
);

// ─── Entrada por webhook (leads) ───────────────────────────────────────────
// docs/plano-webhooks-leads.md, fase A.

/** Origem que pode nos chamar: um cenário do Make, um formulário, o site. */
/**
 * As etapas do funil do Pipedrive, espelhadas aqui.
 *
 * Tabela e não constante: o funil é do comercial e muda quando eles quiserem.
 * Como constante, cada etapa nova no Pipedrive viraria um deploy nosso — e até
 * lá o webhook do agente chegaria com uma etapa que o sistema recusa.
 *
 * Só as que o usuário nomeou são semeadas. As demais se cadastram em
 * `/leads/etapas`: inventar o funil dos outros é como a tela passa a mentir.
 */
export const leadStages = pgTable("lead_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** O que o webhook manda. É o que `contacts.stage` guarda. */
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  /** Ordem no funil — só apresentação; nada no motor depende dela. */
  position: integer("position").notNull().default(0),
  /**
   * Chegar aqui ENCERRA os percursos de automação em andamento.
   *
   * Mora na etapa, e não numa automação, porque é a única ação que nenhum
   * passo sabe fazer: não existe "encerre os outros fluxos". Tudo mais que a
   * etapa deva provocar (tag, e-mail, trocar de fluxo) é automação com gatilho
   * `lead_stage_changed` — um mecanismo só para cada coisa.
   */
  stopsNurturing: boolean("stops_nurturing").notNull().default(false),
  /**
   * Outros nomes que resolvem para esta etapa: a mesma etapa com outro nome
   * em outro funil acompanhado ("Em análise/Agendar apresentação", no
   * SDR-TESTE-NRG), ou o nome antigo depois de um renomear no Pipedrive.
   *
   * Até 14/09/2026 era aqui que as 8 etapas do Pipedrive caíam em 3 marcos;
   * desde então o funil daqui é o de lá, etapa por etapa. Como coluna
   * editável, e não numa rota do Make ou constante, porque tradução escondida
   * é exatamente o que apodrece sem ninguém ver.
   */
  aliases: text("aliases").array(),
  /**
   * Chegar aqui CONVERTE o lead em parceiro, para esta lista.
   *
   * Mora na etapa pela mesma razão do `stopsNurturing`: converter (zerar o
   * `stage` e trocar de lista) é ação que nenhum passo de automação sabe
   * fazer — é o que muda QUEM O CONTATO É, não o que ele recebe. Nulo = a
   * conversão continua manual, na ficha.
   */
  convertListId: uuid("convert_list_id").references(() => lists.id, {
    onDelete: "set null",
  }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type LeadStageRow = typeof leadStages.$inferSelect;

/**
 * As qualificações do lead — espelho do campo "Lead qualificado" do Pipedrive.
 *
 * Mesma história das etapas: era constante de código (o playbook do SDR, com
 * quatro valores) até o Pipedrive ter opções que o código não conhecia, e cada
 * uma delas ser recusada pelo webhook. A lista é do comercial; vive em tabela
 * e se edita em /leads/qualificacoes, sem deploy.
 *
 * Os PONTOS de cada qualificação não moram aqui: são regras de
 * `lead_score_rules` (event_type `lead_qualified`, condition por slug), como
 * sempre foram — a tela de qualificações as edita, mas o mecanismo é um só.
 */
export const leadQualifications = pgTable("lead_qualifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** O que `contacts.qualification` guarda e o webhook resolve. */
  slug: text("slug").notNull().unique(),
  /** O nome exato da opção no Pipedrive ("Sim: Experiente"). */
  label: text("label").notNull(),
  /** Ordem de apresentação — segue a ordem das opções no Pipedrive. */
  position: integer("position").notNull().default(0),
  /** Leitura rápida do playbook ("Alto", "Médio a alto"). Livre. */
  potential: text("potential"),
  /** Variante do Badge na tela (destructive/warning/info/success/secondary). */
  variant: text("variant").notNull().default("secondary"),
  // O texto do playbook do SDR, por seção. É o que separa uma etiqueta de uma
  // informação: quem escreve a nutrição precisa saber o que o rótulo quer
  // dizer no momento em que decide o que mandar.
  quemSao: text("quem_sao"),
  perfil: text("perfil"),
  motivacoes: text("motivacoes"),
  dores: text("dores"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type LeadQualificationRow = typeof leadQualifications.$inferSelect;

/**
 * Espelho dos negócios dos funis acompanhados no Pipedrive, com o lead que
 * cada um casou (por e-mail ou telefone).
 *
 * Existe para a etapa do lead ser decidida por TODOS os negócios dele
 * (lib/pipedrive/regra.ts), e não pelo último que mudou: a passada só lê o que
 * mudou desde a marca-d'água, então os negócios que não mudaram precisam estar
 * guardados em algum lugar. Guardar só o necessário para a decisão — a fonte da
 * verdade continua sendo o Pipedrive.
 */
export const pipedriveDeals = pgTable(
  "pipedrive_deals",
  {
    /** O id do negócio no Pipedrive. */
    id: integer("id").primaryKey(),
    pipelineId: integer("pipeline_id").notNull(),
    /** Nome cru da etapa lá — resolvido na hora da decisão, pelos apelidos. */
    stageName: text("stage_name"),
    /** open | won | lost | deleted, da API; `fora` quando sumiu do funil. */
    status: text("status").notNull(),
    personId: integer("person_id"),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    /** Rótulo da opção do campo de qualificação. */
    qualificacao: text("qualificacao"),
    updateTime: text("update_time").notNull(),
    /** Quando a sincronização viu o negócio pela última vez numa leitura. */
    lidoEm: timestamp("lido_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("pipedrive_deals_contato_idx").on(t.contactId),
    index("pipedrive_deals_funil_idx").on(t.pipelineId, t.lidoEm),
  ]
);
export type PipedriveDealRow = typeof pipedriveDeals.$inferSelect;

export const webhookSources = pgTable(
  "webhook_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Compõe a URL: /api/webhooks/entrada/{slug}. */
    slug: text("slug").notNull().unique(),
    /** SHA-256 do token — o token cru só existe no momento em que é criado. */
    tokenHash: text("token_hash").notNull(),
    /** De onde tirar cada campo no payload: { "email": "data.email" }. */
    mapping: jsonb("mapping").$type<Record<string, string>>(),
    /** O que aplicar quando não vier no payload: tags, lista, estágio. */
    defaults: jsonb("defaults").$type<Record<string, unknown>>(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [index("webhook_sources_slug_idx").on(t.slug)]
);

/**
 * Tudo que chegou, cru. É o que responde "esse lead entrou?" sem depender do
 * histórico do Make, e o que permite reprocessar quando um mapeamento estava
 * errado. Expurgo em 90 dias (scripts/purge-webhook-deliveries.ts).
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => webhookSources.id, { onDelete: "cascade" }),
    /** SHA-256 do corpo — base da janela anti-repetição. */
    payloadHash: text("payload_hash").notNull(),
    payload: jsonb("payload"),
    /** "criado" | "atualizado" | "ignorado" | "rejeitado" | "erro" */
    status: text("status").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    resultado: jsonb("resultado").$type<Record<string, unknown>>(),
    erro: text("erro"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_origem_idx").on(t.sourceId, t.createdAt),
    // A janela anti-repetição procura por (origem, hash) recente.
    index("webhook_deliveries_repeticao_idx").on(t.sourceId, t.payloadHash, t.createdAt),
  ]
);

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category"),
  mjmlContent: text("mjml_content").notNull(),
  // Documento do Criador de email (fonte da verdade quando editorType = builder).
  design: jsonb("design").$type<EmailDesign>(),
  // 'builder' = editado no criador visual; 'code' = MJML/HTML escrito à mão.
  editorType: text("editor_type").$type<EditorType>().notNull().default("code"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Seções reutilizáveis do Criador de email (ex.: Header e Footer da Avante).
export const modules = pgTable("modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  design: jsonb("design").$type<Row>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Modelos de mensagem do WhatsApp — espelho local dos templates da Meta.
// Campanhas de WhatsApp só saem com modelo aprovado (status approved);
// o status é atualizado pelo webhook da Meta e pela sincronização manual.
export const whatsappTemplates = pgTable("whatsapp_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nome na Meta: minúsculas, números e _ (ex.: promo_julho_2026).
  name: text("name").notNull().unique(),
  language: text("language").notNull().default("pt_BR"),
  category: text("category")
    .$type<WhatsAppTemplateCategory>()
    .notNull()
    .default("MARKETING"),
  // draft = só local; os demais espelham a análise da Meta.
  status: text("status")
    .$type<WhatsAppTemplateStatus>()
    .notNull()
    .default("draft"),
  metaTemplateId: text("meta_template_id"),
  headerType: text("header_type")
    .$type<WhatsAppHeaderType>()
    .notNull()
    .default("none"),
  headerText: text("header_text"),
  // Cabeçalho de mídia (imagem/PDF): o caminho servido em /uploads que a Meta
  // baixa a cada envio, o nome exibido no card do documento e o handle da
  // amostra aceita na análise (devolvido pela Resumable Upload API).
  headerMediaUrl: text("header_media_url"),
  headerMediaFilename: text("header_media_filename"),
  headerMediaHandle: text("header_media_handle"),
  // Só no vídeo: o arquivo original enviado (de onde o instante da capa é
  // escolhido) e o instante escolhido em segundos. headerMediaUrl passa a ser
  // a regravação com esse quadro parado no início; null = capa não escolhida,
  // o WhatsApp mostra o primeiro quadro do original.
  headerMediaSourceUrl: text("header_media_source_url"),
  headerMediaCoverAt: doublePrecision("header_media_cover_at"),
  bodyText: text("body_text").notNull(),
  footerText: text("footer_text"),
  buttons: jsonb("buttons").$type<WhatsAppButton[]>(),
  // Exemplos por variável ({"1": "Fernando"}) — exigidos na aprovação.
  variableExamples: jsonb("variable_examples").$type<WhatsAppVariableExamples>(),
  qualityScore: text("quality_score"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  preheader: text("preheader"),
  // Corpo/CTA legados (preenchiam variáveis do template no modelo antigo).
  // Mantidos por compatibilidade; o conteúdo agora vive no design da campanha.
  body: text("body"),
  ctaText: text("cta_text"),
  ctaUrl: text("cta_url"),
  // E-mail próprio da campanha (editado no Criador), copiado de um modelo.
  // design = fonte da verdade quando editorType = builder; mjmlContent = compilado.
  design: jsonb("design").$type<EmailDesign>(),
  mjmlContent: text("mjml_content"),
  editorType: text("editor_type").$type<EditorType>().notNull().default("builder"),
  // Modelo de origem (informativo); a campanha não depende mais dele no envio.
  templateId: uuid("template_id").references(() => templates.id, {
    onDelete: "set null",
  }),
  // Canal de envio: os campos de e-mail (subject/design/mjmlContent) valem
  // para "email"; os whatsapp* abaixo valem para "whatsapp"; smsBody vale
  // para "sms".
  channel: text("channel").$type<CampaignChannel>().notNull().default("email"),
  // "campaign" = campanha comum; "news" = edição do Avante News (sempre
  // e-mail, sempre para a lista de parceiros White Label Ativos).
  kind: text("kind").$type<CampaignKind>().notNull().default("campaign"),
  // Só para kind = "news": além dos parceiros, manda também para a lista de
  // colaboradores (resolveTeamList). Escolhido por edição, no wizard.
  newsIncludeTeam: boolean("news_include_team").notNull().default(false),
  whatsappTemplateId: uuid("whatsapp_template_id").references(
    () => whatsappTemplates.id,
    { onDelete: "set null" }
  ),
  // Fonte de cada variável do modelo ({"1": {"source": "name"}}).
  whatsappVariables: jsonb("whatsapp_variables").$type<WhatsAppVariableMap>(),
  // Texto do SMS, como foi escrito no editor — com acento e tudo. A
  // transliteração para GSM-7 (sanitizeGsm7) acontece no envio, não aqui: o
  // que a pessoa escreveu é o que ela relê ao duplicar a campanha, e guardar
  // já transliterado transformaria "ação" em "acao" para sempre.
  smsBody: text("sms_body"),
  // Listas-alvo da campanha (IDs de lists). Vazio/nulo = todas as listas de
  // RELACIONAMENTO: a lista de leads nunca entra (ver a trava no /send).
  lists: uuid("lists").array(),
  // A coluna `include_leads` existe no banco (migração da fase B) e não é mais
  // usada: campanha é de parceiro, cliente e colaborador, sem exceção. Fica
  // fora daqui de propósito — o código não deve oferecer uma opção que a regra
  // não permite. Não foi derrubada porque apagar coluna em produção não se
  // desfaz, e uma coluna inerte não custa nada.
  tagsFilter: text("tags_filter").array(),
  // Destinatários escolhidos à mão no passo "Destinatários". Nulo = todos os
  // contatos elegíveis das listas/tags (padrão, e o das campanhas antigas);
  // uma lista explícita restringe o envio a esses contatos. A elegibilidade
  // continua valendo por cima: descadastrado/opt-out não recebe nem se estiver
  // escolhido.
  recipientIds: uuid("recipient_ids").array(),
  status: text("status").$type<CampaignStatus>().notNull().default("draft"),
  // Quem disparou. O id liga ao usuário; o nome é uma CÓPIA do momento do
  // envio, para o registro de quem enviou sobreviver à remoção da conta.
  sentByUserId: uuid("sent_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  sentByName: text("sent_by_name"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Um envio a um contato. É a tabela genérica de entrega do sistema: serve às
// campanhas E aos passos de envio das automações (fase 2 do plano). O motivo de
// não ter criado uma tabela nova para a automação é concreto — o webhook do
// WhatsApp casa a confirmação pelo provider_message_id AQUI, e o rastreio de
// abertura, o descadastro e o custo consolidado leem DAQUI. Reaproveitando,
// os quatro passam a valer para a automação sem alteração nenhuma.
export const campaignSends = pgTable("campaign_sends", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Origem do envio: uma campanha OU um passo de automação — nunca os dois,
  // nunca nenhum (restrição campaign_sends_origem_check, na migração).
  campaignId: uuid("campaign_id").references(() => campaigns.id, {
    onDelete: "cascade",
  }),
  // "set null" de propósito: apagar a automação não pode apagar o histórico de
  // envio, que é a base do custo já pago à AWS/Meta.
  automationRunId: uuid("automation_run_id").references(
    () => automationRuns.id,
    { onDelete: "set null" }
  ),
  // Sem FK, como automation_run_steps.step_id: o passo pertence a uma versão e
  // some se a automação for apagada; o envio precisa sobreviver a isso.
  automationStepId: uuid("automation_step_id"),
  // Canal do envio, copiado na criação. Poderia ser deduzido por join (canal da
  // campanha, tipo do passo), mas o custo do mês não pode depender de uma linha
  // que talvez não exista mais — e é a base de cobrança: e-mail conta sentAt,
  // WhatsApp conta deliveredAt.
  channel: text("channel").$type<CampaignChannel>().notNull().default("email"),
  // O e-mail ou telefone exato para onde ESTE envio foi. Nulo nos envios de
  // antes dos endereços múltiplos (valia o endereço do contato).
  address: text("address"),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  status: text("status").$type<SendStatus>().notNull().default("pending"),
  // MessageId retornado pelo provedor de envio (SES). Usado para casar os
  // eventos de devolução/reclamação (SNS) com o envio correspondente.
  providerMessageId: text("provider_message_id"),
  // Só no canal SMS: segmentos cobrados por ESTE envio, gravados no momento em
  // que a mensagem saiu. É a quantidade cobrável do canal — a Twilio cobra por
  // segmento, não por mensagem, e um texto de 200 caracteres custa o dobro de
  // um de 100. Fica aqui, e não calculado do corpo da campanha, pela mesma
  // razão do `channel` logo acima: a conta do mês não pode depender de uma
  // linha que talvez não exista mais, nem mudar de valor porque alguém
  // duplicou a campanha e editou o texto.
  smsSegments: integer("sms_segments"),
  // Segmentos que a TWILIO diz ter cobrado (NumSegments, vem em todo status
  // callback). A coluna acima é a nossa contagem no momento do envio; esta é a
  // do provedor. Existem as duas de propósito: enquanto só houvesse a nossa, o
  // relatório descreveria o que ACHAMOS que enviamos. Qualquer recurso que
  // reescreva o corpo depois da nossa contagem (Link Shortening, Smart
  // Encoding, ligados no console) apareceria como divergência aqui em vez de
  // sumir na fatura. Na dúvida sobre custo, esta manda.
  smsSegmentsBilled: integer("sms_segments_billed"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  // Confirmações do WhatsApp (webhook da Cloud API). A ordem dos eventos não
  // é garantida — o status só avança (pending < sent < delivered < read).
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  // Falha permanente reportada pelo provedor (ex.: 131049 = limite de
  // marketing do destinatário; 131026 = número não pode receber).
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  clickedAt: timestamp("clicked_at", { withTimezone: true }),
  // Devolução (webhook do Resend: email.bounced).
  bouncedAt: timestamp("bounced_at", { withTimezone: true }),
  bounceType: text("bounce_type").$type<BounceType>(),
  // Reclamação de spam (webhook do Resend: email.complained).
  complainedAt: timestamp("complained_at", { withTimezone: true }),
  // Descadastro atribuído a esta campanha (clique no link deste envio).
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  // Primeira resposta do contato a este envio. No WhatsApp e no SMS vem do
  // webhook de mensagem recebida; no e-mail a captura ainda não existe.
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  // Só no WhatsApp: o botão de resposta rápida do modelo que o contato tocou,
  // com o texto exatamente como ele viu. Guarda o ÚLTIMO toque, e não o
  // primeiro, porque é uma decisão e decisões mudam — quem tocou "Vou
  // participar" e depois "Não poderei ir" não vai. A sequência inteira fica
  // na conversa (whatsapp_messages).
  replyButton: text("reply_button"),
  replyButtonAt: timestamp("reply_button_at", { withTimezone: true }),
}, (t) => [
  index("campaign_sends_automacao_idx").on(t.automationRunId),
  // Um passo de envio manda UMA vez por percurso. Esta é a trava contra o job
  // repetido (retry do BullMQ depois de gravar o envio, antes de avançar o
  // percurso) virar mensagem duplicada — que custa dinheiro e irrita o contato.
  uniqueIndex("campaign_sends_automacao_passo_idx")
    .on(t.automationRunId, t.automationStepId)
    .where(sql`${t.automationRunId} is not null`),
  // Uma campanha manda UMA vez para cada contato. Sem isto, dois cliques em
  // "Disparar" (ou um disparo de campanha já agendada) criavam a fila inteira
  // de novo: todo mundo recebia duas vezes e a conta vinha dobrada. O guarda
  // de status no /send fecha o caminho comum; este índice é a garantia dura,
  // no banco, que também cobre a corrida entre duas requisições simultâneas.
  // Parcial porque envio de automação tem campaign_id nulo e é controlado
  // pelo índice acima.
  uniqueIndex("campaign_sends_campanha_contato_idx")
    .on(t.campaignId, t.contactId)
    .where(sql`${t.campaignId} is not null`),
]);

// ─── Conversas de WhatsApp ─────────────────────────────────────────────────
// A caixa de entrada: o que o contato escreve de volta e o que a equipe
// responde pelo sistema. Os modelos disparados por campanha e automação NÃO
// são copiados para cá — eles já vivem em campaign_sends, e a conversa os
// lê de lá. Duplicar seria ter duas verdades sobre o que foi enviado.

export const WHATSAPP_MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type WhatsAppMessageDirection =
  (typeof WHATSAPP_MESSAGE_DIRECTIONS)[number];

/**
 * Uma conversa por NÚMERO, como no próprio WhatsApp. O contato é vínculo, não
 * chave: a mensagem de um número que não está na base também precisa chegar a
 * alguém, e o telefone do contato pode mudar depois.
 *
 * Os campos "last*" e o `unreadCount` são cópias mantidas a cada mensagem —
 * é o que deixa a lista de conversas ser uma consulta simples e ordenada, em
 * vez de agregar a tabela de mensagens inteira a cada atualização da tela.
 */
export const whatsappConversations = pgTable(
  "whatsapp_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** E.164 do contato cadastrado ou, sem contato, o número de quem escreveu. */
    phone: text("phone").notNull().unique(),
    /**
     * Número como o WhatsApp o conhece (sem "+"). No Brasil pode vir sem o
     * nono dígito do celular — é para ele que a resposta é enviada.
     */
    waId: text("wa_id"),
    // Cascata como campaign_sends: excluir o contato leva o que é dele.
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    /** Nome do perfil no WhatsApp — o único nome de quem não está na base. */
    profileName: text("profile_name"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Última mensagem DO CONTATO. Abre a janela de atendimento: até 24h depois
     * dela a Meta aceita texto livre; passado isso, só modelo aprovado.
     */
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastMessagePreview: text("last_message_preview"),
    lastMessageDirection: text("last_message_direction")
      .$type<WhatsAppMessageDirection>(),
    /** Mensagens do contato ainda não abertas por ninguém da equipe. */
    unreadCount: integer("unread_count").notNull().default(0),
    /**
     * Última resposta automática ("aqui não é atendimento"). É a trava de uma
     * por conversa a cada 24h, reservada com UPDATE condicional: duas
     * mensagens chegando juntas não mandam o aviso duas vezes.
     */
    autoRepliedAt: timestamp("auto_replied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("whatsapp_conversations_recentes_idx").on(t.lastMessageAt),
    index("whatsapp_conversations_contato_idx").on(t.contactId),
  ]
);

export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => whatsappConversations.id, { onDelete: "cascade" }),
    direction: text("direction").$type<WhatsAppMessageDirection>().notNull(),
    /**
     * Id da mensagem na Meta. Único porque a Meta reentrega o mesmo evento
     * quando não recebe o 200 a tempo: o índice é a trava contra a mesma
     * mensagem aparecer duas vezes e contar duas vezes. Nulo só na resposta
     * que falhou antes de a Meta aceitá-la.
     */
    wamid: text("wamid").unique(),
    /** Tipo da Cloud API: text, button, image, audio, reaction… */
    type: text("type").notNull(),
    /** Texto, título do botão tocado ou legenda da mídia. */
    body: text("body"),
    buttonPayload: text("button_payload"),
    // Mídia recebida: o arquivo fica na Meta e é buscado sob demanda pelo id.
    mediaId: text("media_id"),
    mediaMimeType: text("media_mime_type"),
    mediaFilename: text("media_filename"),
    /** A mensagem citada. No toque de botão, é o wamid do modelo da campanha. */
    contextWamid: text("context_wamid"),
    /** O envio de campanha/automação a que esta mensagem responde. */
    campaignSendId: uuid("campaign_send_id").references(
      () => campaignSends.id,
      { onDelete: "set null" }
    ),
    // Só na resposta da equipe: o ciclo de entrega, com a mesma regra
    // monotônica dos envios de campanha (lib/whatsapp/webhook.ts).
    status: text("status").$type<SendStatus>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    // Quem respondeu. O nome é cópia do momento, como em campaigns.sentByName:
    // o registro sobrevive à remoção da conta.
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sentByName: text("sent_by_name"),
    /** A mensagem crua da Meta — para os tipos que a tela ainda não desenha. */
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    /** Na recebida, o instante informado pela Meta (não o da chegada aqui). */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("whatsapp_messages_conversa_idx").on(t.conversationId, t.createdAt),
    index("whatsapp_messages_envio_idx").on(t.campaignSendId),
  ]
);

// Configurações do sistema (chave/valor). Hoje guarda qual lista recebe o
// Avante News; serve para qualquer preferência global futura.
/**
 * O modelo de pontuação, em TABELA e não em código: o time vai querer mexer
 * nos pontos depois de ver o score rodando com dados reais — é esperado, e
 * trocar um número não pode exigir deploy.
 *
 * Uma regra por tipo de evento. O `condition` do plano (para distinguir "viu a
 * página de preços" de "visitou o site") fica de fora até a fase E existir e
 * criar eventos de site com página — coluna sem uso só confunde quem lê.
 */
export const leadScoreRules = pgTable("lead_score_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  // SEM unique() desde a fase E: o mesmo tipo tem várias regras quando o
  // evento é nomeado ("viu preços" e "pediu demonstração" são os dois
  // `site_event`, com pesos diferentes). A unicidade virou índice composto
  // (event_type + condition) na migração — ver scripts/migrate-rastreio-site.ts.
  eventType: text("event_type").$type<ContactEventType>().notNull(),
  /**
   * Recorte dentro do tipo, casado contra o payload do evento com a MESMA
   * semântica do gatilho de automação (`casaGatilho`): nulo casa com tudo; com
   * valor, todas as chaves precisam bater. Ex.: `{"evento":"demo"}`.
   */
  condition: jsonb("condition").$type<Record<string, unknown>>(),
  /** Pontos no dia do evento, antes do decaimento. Aceita negativo. */
  points: integer("points").notNull(),
  active: boolean("active").notNull().default(true),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * De que página nasce cada evento nomeado — a tradução `caminho → evento`.
 *
 * Vive no SERVIDOR, e não assada no script do site, por dois motivos. O
 * endpoint precisa validar o nome do evento contra uma lista fechada de
 * qualquer jeito (o script é código do cliente: um POST forjado manda o nome
 * que quiser), então a lista fechada tem que estar aqui. E mudar "qual página
 * conta como intenção" passa a valer para o histórico na próxima leitura, em
 * vez de só dali para a frente.
 */
export const SITE_MATCH_TYPES = ["exato", "prefixo"] as const;
export type SiteMatchType = (typeof SITE_MATCH_TYPES)[number];

/**
 * Eventos de site de visitantes AINDA ANÔNIMOS (fase E.2).
 *
 * A peça que faltava para "saber que o lead entrou no site antes do e-mail":
 * o script coleta com um identificador próprio de visitante desde a primeira
 * visita, e quando a identidade aparece (token do e-mail, ou o formulário que
 * o webhook entrega), o histórico daqui é COSTURADO em `contact_events` — com
 * o `created_at` original, para o decaimento do score valer de verdade.
 *
 * Tabela separada de propósito: `contact_events` exige contato, e visitante
 * anônimo não é contato — é uma promessa de um. Retenção de 90 dias (limpeza
 * no worker): anônimo que nunca vira lead expira, por higiene de LGPD.
 */
export const anonymousSiteEvents = pgTable("anonymous_site_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** O identificador do navegador, gerado pelo script (opaco, saneado). */
  visitorId: text("visitor_id").notNull(),
  type: text("type").$type<"site_visited" | "site_event">().notNull(),
  /** Mesmo formato do payload de contact_events — é o que permite a costura. */
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type AnonymousSiteEventRow = typeof anonymousSiteEvents.$inferSelect;

export const siteEventRules = pgTable("site_event_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Nome do evento gerado: slug curto, casado com a regra de pontuação. */
  evento: text("evento").notNull(),
  matchType: text("match_type").$type<SiteMatchType>().notNull(),
  /** Caminho normalizado (minúsculo, sem query, sem barra final). */
  valor: text("valor").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type List = typeof lists.$inferSelect;
export type NewList = typeof lists.$inferInsert;
export type ContactPhone = typeof contactPhones.$inferSelect;
export type NewContactPhone = typeof contactPhones.$inferInsert;
export type ContactEmail = typeof contactEmails.$inferSelect;
export type NewContactEmail = typeof contactEmails.$inferInsert;
export type ContactList = typeof contactLists.$inferSelect;
export type NewContactList = typeof contactLists.$inferInsert;
export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type WhatsAppTemplate = typeof whatsappTemplates.$inferSelect;
export type NewWhatsAppTemplate = typeof whatsappTemplates.$inferInsert;
export type CampaignSend = typeof campaignSends.$inferSelect;
export type NewCampaignSend = typeof campaignSends.$inferInsert;
export type WhatsAppConversation = typeof whatsappConversations.$inferSelect;
export type WhatsAppMessage = typeof whatsappMessages.$inferSelect;
export type NewWhatsAppMessage = typeof whatsappMessages.$inferInsert;
export type Module = typeof modules.$inferSelect;
export type NewModule = typeof modules.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;
export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
export type LeadScoreRule = typeof leadScoreRules.$inferSelect;
export type NewLeadScoreRule = typeof leadScoreRules.$inferInsert;
export type SiteEventRule = typeof siteEventRules.$inferSelect;
export type NewSiteEventRule = typeof siteEventRules.$inferInsert;
