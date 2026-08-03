import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: automações (Fase 1 do docs/plano-automacoes.md).
// Cria as tabelas do fluxo e dos percursos. Nada existente é alterado — sem
// automação cadastrada, o motor não faz nada.
// Rode uma vez: `npx tsx scripts/migrate-automations.ts`

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

  console.log("[MIGRATE] automations + versões...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS automations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      description text,
      status text NOT NULL DEFAULT 'draft',
      current_version_id uuid,
      created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS automation_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
      version integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS automation_versions_idx
       ON automation_versions (automation_id, version)`
  );

  console.log("[MIGRATE] gatilhos e passos...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS automation_triggers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      version_id uuid NOT NULL REFERENCES automation_versions(id) ON DELETE CASCADE,
      type text NOT NULL,
      config jsonb
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS automation_triggers_versao_idx
       ON automation_triggers (version_id, type)`
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS automation_steps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      version_id uuid NOT NULL REFERENCES automation_versions(id) ON DELETE CASCADE,
      parent_id uuid,
      branch text NOT NULL DEFAULT 'main',
      position integer NOT NULL DEFAULT 0,
      type text NOT NULL,
      config jsonb
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS automation_steps_ordem_idx
       ON automation_steps (version_id, parent_id, branch, position)`
  );

  console.log("[MIGRATE] percursos e log por passo...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS automation_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
      version_id uuid NOT NULL REFERENCES automation_versions(id) ON DELETE CASCADE,
      contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      current_step_id uuid,
      status text NOT NULL DEFAULT 'running',
      next_run_at timestamptz,
      steps_executed integer NOT NULL DEFAULT 0,
      stopped_reason text,
      entered_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    )
  `);
  // Reentrada = não. Este índice é a trava contra evento repetido criar
  // percurso duplicado para o mesmo contato.
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_unico_idx
       ON automation_runs (automation_id, contact_id)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS automation_runs_pendentes_idx
       ON automation_runs (status, next_run_at)`
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS automation_run_steps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id uuid NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
      step_id uuid NOT NULL,
      status text NOT NULL,
      result jsonb,
      at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS automation_run_steps_idx
       ON automation_run_steps (run_id, at)`
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
