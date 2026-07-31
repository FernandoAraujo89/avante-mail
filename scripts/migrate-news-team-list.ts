import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: o Avante News pode ir também para os colaboradores.
// campaigns.news_include_team = false (padrão) mantém o comportamento atual —
// só a lista de parceiros. A lista de colaboradores em si fica em app_settings
// (chave avante_news_team_list_id), como já acontece com a de parceiros.
// Rode uma vez: `npx tsx scripts/migrate-news-team-list.ts`

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

  console.log("[MIGRATE] campaigns: Avante News também para colaboradores...");
  await client.query(
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS news_include_team boolean NOT NULL DEFAULT false`
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
