import { sql } from "drizzle-orm";
import {
  boolean,
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
export const CAMPAIGN_CHANNELS = ["email", "whatsapp"] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

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

// Estágio do lead no funil. Nulo = o contato não é lead.
export const LEAD_STAGES = [
  "novo",
  "contatado",
  "qualificado",
  "convertido",
  "perdido",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

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
  // Movimentação do lead no funil, feita na área de Leads. Fica registrado
  // aqui para a linha do tempo da ficha e para o Lead Score (fase C) — o motor
  // de automações ignora o que nenhum gatilho declara, então adicionar o tipo
  // não mexe em nenhum fluxo em produção.
  "lead_stage_changed",
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
export const LEAD_SCORE_BANDS = ["frio", "morno", "quente"] as const;
export type LeadScoreBand = (typeof LEAD_SCORE_BANDS)[number];

// Usuários do sistema (login próprio).
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
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

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
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

  // ── Lead (docs/plano-webhooks-leads.md) ──────────────────────────────
  // Nulo = não é lead; é parceiro/contato comum. A separação operacional é
  // feita pela LISTA "Leads"; este campo é o estágio dentro do funil.
  stage: text("stage").$type<LeadStage>(),

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
  // para "email"; os whatsapp* abaixo valem para "whatsapp".
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
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  status: text("status").$type<SendStatus>().notNull().default("pending"),
  // MessageId retornado pelo provedor de envio (SES). Usado para casar os
  // eventos de devolução/reclamação (SNS) com o envio correspondente.
  providerMessageId: text("provider_message_id"),
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
  // Resposta do contato a este e-mail. Coluna preparada para exibir o
  // histórico de respostas por contato; a captura (marcação manual ou
  // inbound automático via Resend) ainda não está ativada.
  repliedAt: timestamp("replied_at", { withTimezone: true }),
}, (t) => [
  index("campaign_sends_automacao_idx").on(t.automationRunId),
  // Um passo de envio manda UMA vez por percurso. Esta é a trava contra o job
  // repetido (retry do BullMQ depois de gravar o envio, antes de avançar o
  // percurso) virar mensagem duplicada — que custa dinheiro e irrita o contato.
  uniqueIndex("campaign_sends_automacao_passo_idx")
    .on(t.automationRunId, t.automationStepId)
    .where(sql`${t.automationRunId} is not null`),
]);

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
