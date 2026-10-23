import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente do projeto "Mapeamento da Parceria" (docs/plano-expansao.md,
// seção 12): perfil do parceiro (classificação e responsável), validação dos
// dados no convite, passos da régua de follow-up e alertas de risco. Só
// adiciona — tabela nova, coluna nova nullable, índice novo. Roda DEPOIS de
// migrate-pesquisas.ts (ordem alfabética do loop do deploy).

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

  console.log("[MIGRATE] survey_invites: validação e motivo do encerramento...");
  await client.query(`ALTER TABLE survey_invites ADD COLUMN IF NOT EXISTS validated_at timestamptz`);
  await client.query(
    `ALTER TABLE survey_invites
       ADD COLUMN IF NOT EXISTS validated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL`
  );
  await client.query(`ALTER TABLE survey_invites ADD COLUMN IF NOT EXISTS validated_by_name text`);
  await client.query(`ALTER TABLE survey_invites ADD COLUMN IF NOT EXISTS closed_reason text`);

  console.log("[MIGRATE] partner_profiles...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS partner_profiles (
      contact_id uuid PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
      tier text,
      owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      owner_name text,
      notes text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  console.log("[MIGRATE] survey_followups...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS survey_followups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      invite_id uuid NOT NULL REFERENCES survey_invites(id) ON DELETE CASCADE,
      kind text NOT NULL,
      note text,
      by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      by_name text,
      at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS survey_followups_convite_idx ON survey_followups (invite_id)`
  );

  console.log("[MIGRATE] survey_alerts...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS survey_alerts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      invite_id uuid NOT NULL REFERENCES survey_invites(id) ON DELETE CASCADE,
      survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      question_id uuid REFERENCES survey_questions(id) ON DELETE SET NULL,
      reason text NOT NULL,
      detail text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      due_at timestamptz NOT NULL,
      handled_at timestamptz,
      handled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      handled_by_name text,
      note text
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS survey_alerts_contato_idx ON survey_alerts (contact_id)`);
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS survey_alerts_convite_motivo_idx ON survey_alerts (invite_id, reason)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS survey_alerts_abertos_idx ON survey_alerts (due_at) WHERE handled_at IS NULL`
  );

  console.log("[MIGRATE] Mapeamento da Parceria: concluído.");
}

main()
  .catch((error) => {
    console.error("[MIGRATE] erro:", error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
