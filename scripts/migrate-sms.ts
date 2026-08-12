import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: fundação do canal SMS (Twilio).
// - contacts: consentimento próprio do canal (sms_subscribed + opt-in/out).
//   O telefone (E.164) já existe desde a migração do WhatsApp e é
//   compartilhado; o CONSENTIMENTO não é — LGPD trata cada canal como um
//   aceite, e o opt-out de um não derruba o outro.
// - campaign_sends: nada a fazer — channel/delivered_at/error_* já existem
//   desde o WhatsApp e servem ao SMS do mesmo jeito.
// Nada aqui altera colunas ou dados dos canais de e-mail e WhatsApp.
// Rode uma vez: `npx tsx scripts/migrate-sms.ts`

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

  console.log("[MIGRATE] contacts: consentimento de SMS...");
  await client.query(
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sms_subscribed boolean NOT NULL DEFAULT false`
  );
  await client.query(
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sms_opt_in_at timestamptz`
  );
  await client.query(
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sms_opt_out_at timestamptz`
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
