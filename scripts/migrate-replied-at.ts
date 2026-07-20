import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: adiciona campaign_sends.replied_at (timestamptz).
// Coluna que guarda a resposta do contato a um e-mail, exibida no histórico
// por contato. A captura (marcação manual ou inbound) ainda não está ativada.
// Rode uma vez: `npx tsx scripts/migrate-replied-at.ts`

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

  console.log("[MIGRATE] Adicionando coluna replied_at (se necessário)...");
  await client.query(
    `ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS replied_at timestamptz`
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
