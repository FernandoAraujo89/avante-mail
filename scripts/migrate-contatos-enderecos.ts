import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: endereços múltiplos por contato.
//   - contact_phones e contact_emails (vários por contato, consentimento por
//     endereço — ver lib/db/schema.ts);
//   - contacts.email passa a aceitar nulo (contato só com telefone);
//   - campaign_sends.address: para onde cada envio foi;
//   - copia o e-mail e o telefone de cada contato, com o consentimento que ele
//     tinha, para as tabelas novas, como endereço principal.
// Roda automaticamente no deploy (loop de scripts/migrate-*.ts).

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[MIGRATE] DATABASE_URL não definida.");
  process.exit(1);
}

const needsSsl = /sslmode=require|neon\.tech/.test(url);
const client = new Client({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  await client.connect();

  console.log("[MIGRATE] Tabelas contact_phones e contact_emails...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS contact_phones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      phone text NOT NULL UNIQUE,
      whatsapp_subscribed boolean NOT NULL DEFAULT false,
      whatsapp_opt_in_at timestamptz,
      whatsapp_opt_out_at timestamptz,
      sms_subscribed boolean NOT NULL DEFAULT false,
      sms_opt_in_at timestamptz,
      sms_opt_out_at timestamptz,
      principal boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS contact_phones_contato_idx ON contact_phones (contact_id)`
  );
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS contact_phones_principal_idx ON contact_phones (contact_id) WHERE principal`
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS contact_emails (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      email text NOT NULL UNIQUE,
      subscribed boolean NOT NULL DEFAULT true,
      opt_out_at timestamptz,
      principal boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS contact_emails_contato_idx ON contact_emails (contact_id)`
  );
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS contact_emails_principal_idx ON contact_emails (contact_id) WHERE principal`
  );

  console.log(
    "[MIGRATE] contacts.email aceita nulo; campaign_sends.address..."
  );
  await client.query(`ALTER TABLE contacts ALTER COLUMN email DROP NOT NULL`);
  await client.query(
    `ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS address text`
  );

  // O marcador que o webhook de leads inventava quando só vinha telefone
  // deixa de existir: agora o e-mail pode simplesmente faltar.
  const semEmail = await client.query(
    `UPDATE contacts SET email = NULL WHERE email LIKE '%@sem-email.local'`
  );
  if (semEmail.rowCount) {
    console.log(
      `[MIGRATE] ${semEmail.rowCount} marcador(es) @sem-email.local apagado(s).`
    );
  }

  console.log("[MIGRATE] Copiando e-mail e telefone de cada contato...");
  // Principal só se o contato ainda não tiver um: rodar de novo depois de a
  // pessoa trocar o principal na tela não pode brigar com a escolha dela.
  const emails = await client.query(`
    INSERT INTO contact_emails (contact_id, email, subscribed, opt_out_at, principal, created_at)
    SELECT c.id, lower(c.email), c.subscribed, c.email_opt_out_at,
           NOT EXISTS (SELECT 1 FROM contact_emails e WHERE e.contact_id = c.id AND e.principal),
           c.created_at
      FROM contacts c
     WHERE c.email IS NOT NULL
    ON CONFLICT (email) DO NOTHING
  `);
  const phones = await client.query(`
    INSERT INTO contact_phones (contact_id, phone, whatsapp_subscribed, whatsapp_opt_in_at, whatsapp_opt_out_at,
                                sms_subscribed, sms_opt_in_at, sms_opt_out_at, principal, created_at)
    SELECT c.id, c.phone, c.whatsapp_subscribed, c.whatsapp_opt_in_at, c.whatsapp_opt_out_at,
           c.sms_subscribed, c.sms_opt_in_at, c.sms_opt_out_at,
           NOT EXISTS (SELECT 1 FROM contact_phones p WHERE p.contact_id = c.id AND p.principal),
           c.created_at
      FROM contacts c
     WHERE c.phone IS NOT NULL
    ON CONFLICT (phone) DO NOTHING
  `);
  console.log(
    `[MIGRATE] ${emails.rowCount ?? 0} e-mail(s) e ${phones.rowCount ?? 0} telefone(s) copiados.`
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
