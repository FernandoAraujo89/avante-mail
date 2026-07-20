import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: campaign_sends.resend_id -> provider_message_id.
// Renomeia a coluna do ID do provedor de envio ao migrar de Resend para o
// Amazon SES. Em banco novo (sem a coluna antiga), apenas garante que a
// coluna nova exista.
// Rode uma vez: `npx tsx scripts/migrate-provider-message-id.ts`

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

  console.log("[MIGRATE] Renomeando resend_id -> provider_message_id (se necessário)...");
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'campaign_sends' AND column_name = 'resend_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'campaign_sends' AND column_name = 'provider_message_id'
      ) THEN
        ALTER TABLE campaign_sends RENAME COLUMN resend_id TO provider_message_id;
      END IF;
    END $$;
  `);

  // Banco novo (nunca teve resend_id): garante a coluna.
  await client.query(
    `ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS provider_message_id text`
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
