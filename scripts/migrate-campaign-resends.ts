import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: registro dos reenvios avulsos do e-mail de uma
// campanha já disparada (lib/reenvio). Uma linha por endereço reenviado, com
// quem reenviou e o resultado. Fica fora de campaign_sends porque o endereço
// pode não ser de um contato e o mesmo endereço pode receber de novo.
// Rode uma vez: `npx tsx scripts/migrate-campaign-resends.ts`

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

  console.log("[MIGRATE] campaign_resends: reenvios avulsos de e-mail...");
  await client.query(
    `CREATE TABLE IF NOT EXISTS campaign_resends (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
       email text NOT NULL,
       contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
       name text,
       status text NOT NULL,
       error_message text,
       provider_message_id text,
       sent_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
       sent_by_name text,
       created_at timestamptz NOT NULL DEFAULT now()
     )`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS campaign_resends_campanha_idx
       ON campaign_resends (campaign_id)`
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
