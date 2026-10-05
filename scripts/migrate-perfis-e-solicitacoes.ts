import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: perfil de acesso dos usuários (users.role) e a tabela
// de solicitações de campanha (campaign_requests).
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

  console.log("[MIGRATE] Coluna users.role (quem já existe vira admin)...");
  await client.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin'`
  );

  console.log("[MIGRATE] Tabela campaign_requests...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS campaign_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL,
      channels text[] NOT NULL,
      list_ids uuid[] NOT NULL,
      briefing text NOT NULL,
      desired_at timestamptz,
      status text NOT NULL DEFAULT 'pendente',
      response_note text,
      requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
      handled_by uuid REFERENCES users(id) ON DELETE SET NULL,
      campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  console.log("[MIGRATE] Concluído.");
  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
