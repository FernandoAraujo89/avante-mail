import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: separa o Avante News das campanhas.
// - campaigns.kind: 'campaign' (padrão, tudo que já existe) | 'news';
// - app_settings: configurações do sistema (chave/valor). Guarda o id da lista
//   de parceiros White Label Ativos — destino fixo de todo Avante News.
// Nada aqui altera dados existentes: campanhas antigas continuam 'campaign'.
// Rode uma vez: `npx tsx scripts/migrate-avante-news.ts`

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

  console.log("[MIGRATE] campaigns: coluna kind (campaign | news)...");
  await client.query(
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'campaign'`
  );
  // Filtro mais comum dos relatórios: canal + tipo.
  await client.query(
    `CREATE INDEX IF NOT EXISTS campaigns_kind_channel_idx ON campaigns (kind, channel)`
  );

  console.log("[MIGRATE] Criando tabela app_settings...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key text PRIMARY KEY,
      value text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // Conveniência: se a lista de White Label Ativos já existir, deixa o Avante
  // News apontado para ela. O usuário pode trocar depois na tela do Avante News.
  const existing = await client.query(
    `SELECT value FROM app_settings WHERE key = 'avante_news_list_id'`
  );
  if (existing.rowCount === 0) {
    const candidate = await client.query(
      `SELECT id, name FROM lists
        WHERE name ILIKE '%white label%'
        ORDER BY (name ILIKE '%ativ%') DESC, name ASC
        LIMIT 1`
    );
    if (candidate.rowCount && candidate.rowCount > 0) {
      await client.query(
        `INSERT INTO app_settings (key, value) VALUES ('avante_news_list_id', $1)`,
        [candidate.rows[0].id]
      );
      console.log(
        `[MIGRATE] Lista do Avante News definida como "${candidate.rows[0].name}".`
      );
    } else {
      console.log(
        "[MIGRATE] Nenhuma lista de White Label encontrada — escolha a lista na tela do Avante News."
      );
    }
  }

  console.log("[MIGRATE] Concluído.");

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
