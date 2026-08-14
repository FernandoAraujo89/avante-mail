import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: canal SMS (Twilio).
// - contacts: consentimento próprio do canal (sms_subscribed + opt-in/out).
//   O telefone (E.164) já existe desde a migração do WhatsApp e é
//   compartilhado; o CONSENTIMENTO não é — LGPD trata cada canal como um
//   aceite, e o opt-out de um não derruba o outro.
// - campaigns: sms_body, o texto da mensagem. Os campos de e-mail (subject,
//   design) e de WhatsApp (whatsapp_template_id) não servem: o SMS não tem
//   assunto, não tem HTML e não passa por modelo aprovado.
// - campaign_sends: sms_segments, a quantidade cobrada. channel, delivered_at
//   e error_* já existem desde o WhatsApp e servem ao SMS do mesmo jeito.
// Nada aqui altera colunas ou dados dos canais de e-mail e WhatsApp.
// Rode de novo sem medo — é idempotente: `npx tsx scripts/migrate-sms.ts`

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

  console.log("[MIGRATE] campaigns: texto do SMS...");
  await client.query(
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sms_body text`
  );

  console.log("[MIGRATE] campaign_sends: segmentos cobrados...");
  await client.query(
    `ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS sms_segments integer`
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
