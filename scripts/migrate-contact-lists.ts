import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: introduz listas de contato (substituem segmentos).
// - cria tabelas `lists` e `contact_lists` (N:N contato<->lista);
// - adiciona `campaigns.lists` (uuid[]) para o alvo por lista;
// - remove as colunas antigas de segmento (contacts.segment, campaigns.segments).
// Rode uma vez: `npx tsx scripts/migrate-contact-lists.ts`

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

  console.log("[MIGRATE] Criando tabela lists...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS lists (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      description text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  console.log("[MIGRATE] Criando tabela contact_lists...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS contact_lists (
      contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      PRIMARY KEY (contact_id, list_id)
    )
  `);

  console.log("[MIGRATE] Ajustando campaigns (lists) e removendo segmentos...");
  await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS lists uuid[]`);
  await client.query(`ALTER TABLE campaigns DROP COLUMN IF EXISTS segments`);
  await client.query(`ALTER TABLE contacts DROP COLUMN IF EXISTS segment`);

  console.log("[MIGRATE] Concluído.");

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
