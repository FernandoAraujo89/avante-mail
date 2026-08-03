import {
  boolean,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Listas de contato criadas pelo usuário (substituem os antigos segmentos).
export const lists = pgTable("lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
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
  // Listas-alvo da campanha (IDs de lists). Vazio/nulo = todas as listas.
  lists: uuid("lists").array(),
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

export const campaignSends = pgTable("campaign_sends", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
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
});

// Configurações do sistema (chave/valor). Hoje guarda qual lista recebe o
// Avante News; serve para qualquer preferência global futura.
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
