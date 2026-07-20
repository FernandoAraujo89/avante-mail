import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: campaigns.segment (single) -> campaigns.segments (text[]).
// Faz backfill dos dados existentes e remove a coluna antiga.
// Rode uma vez: `npx tsx scripts/migrate-multi-segment.ts`

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

async function columnExists(name: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'campaigns' AND column_name = $1`,
    [name]
  );
  return rows.length > 0;
}

async function main() {
  await client.connect();

  console.log("[MIGRATE] Adicionando coluna segments (se necessário)...");
  await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS segments text[]`);

  if (await columnExists("segment")) {
    console.log("[MIGRATE] Backfill de segment -> segments...");
    // Só migra segmentos reais; 'todos'/nulo/vazio ficam como NULL (= todos).
    await client.query(`
      UPDATE campaigns
      SET segments = ARRAY[segment]
      WHERE segments IS NULL
        AND segment IS NOT NULL
        AND segment <> ''
        AND segment <> 'todos'
    `);

    console.log("[MIGRATE] Removendo coluna antiga segment...");
    await client.query(`ALTER TABLE campaigns DROP COLUMN IF EXISTS segment`);
  } else {
    console.log("[MIGRATE] Coluna segment já não existe, nada a migrar.");
  }

  const { rows } = await client.query(
    `SELECT count(*)::int AS total FROM campaigns WHERE segments IS NOT NULL`
  );
  console.log(
    `[MIGRATE] Concluído. Campanhas com segmentos específicos: ${rows[0].total}.`
  );

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
