import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: senha opcional no cadastro de usuário — quem é criado
// sem senha define a sua por "Esqueci minha senha". Também remove as colunas
// do login pelo Google, abandonado em 22/10/2026 (docs/plano-expansao.md).
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

  console.log("[MIGRATE] users: senha opcional...");
  await client.query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`);

  console.log("[MIGRATE] users: sem as colunas do login Google...");
  await client.query(`DROP INDEX IF EXISTS users_google_sub_unique`);
  await client.query(`ALTER TABLE users DROP COLUMN IF EXISTS google_sub`);
  await client.query(`ALTER TABLE users DROP COLUMN IF EXISTS last_login_at`);

  console.log("[MIGRATE] Concluído.");
  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
