import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: campanhas passam a ter e-mail próprio (design editável),
// copiado de um modelo e editado no Criador durante a criação da campanha.
// Adiciona: design (jsonb), mjml_content (text), editor_type (text, default builder).
// Rode uma vez: `npx tsx scripts/migrate-campaign-design.ts`

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

  console.log("[MIGRATE] Adicionando colunas de e-mail próprio em campaigns...");
  await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS design jsonb`);
  await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS mjml_content text`);
  await client.query(
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS editor_type text NOT NULL DEFAULT 'builder'`
  );

  const { rows } = await client.query(
    `SELECT count(*)::int AS total FROM campaigns WHERE design IS NOT NULL`
  );
  console.log(
    `[MIGRATE] Concluído. Campanhas com e-mail próprio: ${rows[0].total}.`
  );

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
