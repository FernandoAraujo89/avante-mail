import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: conversas de WhatsApp (caixa de entrada e respostas
// pelos botões dos modelos).
// - whatsapp_conversations: uma por número, com os resumos da lista;
// - whatsapp_messages: o que o contato escreve e o que a equipe responde;
// - campaign_sends.reply_button(_at): o botão de resposta rápida tocado, que é
//   o que o relatório da campanha apura;
// - whatsapp_conversations.auto_replied_at: a trava da resposta automática.
// Nada aqui altera dado existente. Rode: `npx tsx scripts/migrate-whatsapp-conversas.ts`

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[MIGRATE] DATABASE_URL não definida no .env.local.");
  process.exit(1);
}

const needsSsl = /sslmode=require|neon\.tech/.test(url);
const client = new Client({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  await client.connect();

  console.log("[MIGRATE] campaign_sends: botão de resposta rápida...");
  await client.query(
    `ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS reply_button text`
  );
  await client.query(
    `ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS reply_button_at timestamptz`
  );

  console.log("[MIGRATE] Criando tabela whatsapp_conversations...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone text NOT NULL CONSTRAINT whatsapp_conversations_phone_unique UNIQUE,
      wa_id text,
      contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
      profile_name text,
      last_message_at timestamptz NOT NULL DEFAULT now(),
      last_inbound_at timestamptz,
      last_message_preview text,
      last_message_direction text,
      unread_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS whatsapp_conversations_recentes_idx
       ON whatsapp_conversations (last_message_at)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS whatsapp_conversations_contato_idx
       ON whatsapp_conversations (contact_id)`
  );

  console.log("[MIGRATE] whatsapp_conversations: trava da resposta automática...");
  await client.query(
    `ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS auto_replied_at timestamptz`
  );

  console.log("[MIGRATE] Criando tabela whatsapp_messages...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
      direction text NOT NULL,
      wamid text CONSTRAINT whatsapp_messages_wamid_unique UNIQUE,
      type text NOT NULL,
      body text,
      button_payload text,
      media_id text,
      media_mime_type text,
      media_filename text,
      context_wamid text,
      campaign_send_id uuid REFERENCES campaign_sends(id) ON DELETE SET NULL,
      status text,
      error_code text,
      error_message text,
      sent_at timestamptz,
      delivered_at timestamptz,
      read_at timestamptz,
      sent_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      sent_by_name text,
      raw jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS whatsapp_messages_conversa_idx
       ON whatsapp_messages (conversation_id, created_at)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS whatsapp_messages_envio_idx
       ON whatsapp_messages (campaign_send_id)`
  );

  console.log("[MIGRATE] Concluído.");
  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
