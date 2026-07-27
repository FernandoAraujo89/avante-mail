import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: fundação do canal WhatsApp (Fase 1 do plano em
// docs/plano-campanhas-whatsapp.md).
// - contacts: telefone (E.164, único) + consentimento próprio do canal;
// - whatsapp_templates: espelho local dos modelos de mensagem da Meta;
// - campaigns: canal (email|whatsapp), modelo e mapa de variáveis;
// - campaign_sends: confirmações (entregue/lida) e erro do provedor.
// Nada aqui altera colunas ou dados existentes do canal de e-mail.
// Rode uma vez: `npx tsx scripts/migrate-whatsapp.ts`

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

  console.log("[MIGRATE] contacts: telefone e consentimento de WhatsApp...");
  await client.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone text`);
  await client.query(
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS whatsapp_subscribed boolean NOT NULL DEFAULT false`
  );
  await client.query(
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at timestamptz`
  );
  await client.query(
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS whatsapp_opt_out_at timestamptz`
  );
  // Mesmo nome de constraint que o drizzle-kit geraria (contacts_phone_unique)
  // para dev (db:push) e prod ficarem idênticos.
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'contacts_phone_unique'
      ) THEN
        ALTER TABLE contacts ADD CONSTRAINT contacts_phone_unique UNIQUE (phone);
      END IF;
    END $$;
  `);

  console.log("[MIGRATE] Criando tabela whatsapp_templates...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL CONSTRAINT whatsapp_templates_name_unique UNIQUE,
      language text NOT NULL DEFAULT 'pt_BR',
      category text NOT NULL DEFAULT 'MARKETING',
      status text NOT NULL DEFAULT 'draft',
      meta_template_id text,
      header_type text NOT NULL DEFAULT 'none',
      header_text text,
      body_text text NOT NULL,
      footer_text text,
      buttons jsonb,
      variable_examples jsonb,
      quality_score text,
      rejection_reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  console.log("[MIGRATE] campaigns: canal e modelo de WhatsApp...");
  await client.query(
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email'`
  );
  await client.query(`
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS whatsapp_template_id uuid
      REFERENCES whatsapp_templates(id) ON DELETE SET NULL
  `);
  await client.query(
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS whatsapp_variables jsonb`
  );

  console.log("[MIGRATE] campaign_sends: status de entrega/leitura e erro...");
  await client.query(
    `ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS delivered_at timestamptz`
  );
  await client.query(
    `ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS read_at timestamptz`
  );
  await client.query(
    `ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS error_code text`
  );
  await client.query(
    `ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS error_message text`
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
