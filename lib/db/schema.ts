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

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const SEND_STATUSES = [
  "pending",
  "sent",
  "failed",
  "opened",
  "clicked",
  "bounced",
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
  // Listas-alvo da campanha (IDs de lists). Vazio/nulo = todas as listas.
  lists: uuid("lists").array(),
  tagsFilter: text("tags_filter").array(),
  status: text("status").$type<CampaignStatus>().notNull().default("draft"),
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
export type CampaignSend = typeof campaignSends.$inferSelect;
export type NewCampaignSend = typeof campaignSends.$inferInsert;
export type Module = typeof modules.$inferSelect;
export type NewModule = typeof modules.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;
