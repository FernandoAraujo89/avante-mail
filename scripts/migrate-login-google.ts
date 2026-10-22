import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: login pelo Google Workspace (docs/plano-expansao.md,
// parte 7) — senha opcional, id da conta Google e último login.
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

  console.log("[MIGRATE] users: senha opcional, google_sub, last_login_at...");
  await client.query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub text`);
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique ON users (google_sub)`
  );
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz`);

  console.log("[MIGRATE] Concluído.");
  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
