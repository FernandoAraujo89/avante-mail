import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: pesquisas com parceiros (docs/plano-expansao.md) —
// surveys, survey_questions, survey_invites e survey_answers.
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

  console.log("[MIGRATE] Tabela surveys...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS surveys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      objective text NOT NULL,
      name text NOT NULL,
      intro text,
      thanks text,
      status text NOT NULL DEFAULT 'draft',
      email_subject text,
      email_body text,
      whatsapp_template_id uuid REFERENCES whatsapp_templates(id) ON DELETE SET NULL,
      created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      created_by_name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  console.log("[MIGRATE] Tabela survey_questions...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS survey_questions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      position integer NOT NULL DEFAULT 0,
      type text NOT NULL,
      label text NOT NULL,
      help text,
      required boolean NOT NULL DEFAULT false,
      options jsonb,
      is_nps boolean NOT NULL DEFAULT false,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS survey_questions_pesquisa_idx ON survey_questions (survey_id, position)`
  );

  console.log("[MIGRATE] Tabela survey_invites...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS survey_invites (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      status text NOT NULL DEFAULT 'pending',
      opened_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      closed_at timestamptz,
      reminders_sent integer NOT NULL DEFAULT 0,
      last_reminder_at timestamptz,
      created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      created_by_name text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS survey_invites_pesquisa_idx ON survey_invites (survey_id)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS survey_invites_contato_idx ON survey_invites (contact_id)`
  );
  // Um convite aberto por parceiro por pesquisa; concluído/encerrado libera a
  // rodada seguinte.
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS survey_invites_aberto_idx
       ON survey_invites (survey_id, contact_id)
       WHERE status NOT IN ('completed', 'closed')`
  );

  console.log("[MIGRATE] Tabela survey_answers...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS survey_answers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      invite_id uuid NOT NULL REFERENCES survey_invites(id) ON DELETE CASCADE,
      question_id uuid NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS survey_answers_convite_pergunta_idx ON survey_answers (invite_id, question_id)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS survey_answers_pergunta_idx ON survey_answers (question_id)`
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
