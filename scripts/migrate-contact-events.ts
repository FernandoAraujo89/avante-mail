import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: fila de eventos do contato (Fase 0 do plano de
// automações, docs/plano-automacoes.md).
// Só registra o que acontece — nada passa a consumir estes eventos ainda, e
// nenhum comportamento existente muda. O motor das automações (Fase 1) é quem
// vai marcar processed_at.
// Rode uma vez: `npx tsx scripts/migrate-contact-events.ts`

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

  console.log("[MIGRATE] Criando tabela contact_events...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS contact_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      type text NOT NULL,
      payload jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      processed_at timestamptz
    )
  `);

  // O motor varre os pendentes em ordem de chegada.
  await client.query(
    `CREATE INDEX IF NOT EXISTS contact_events_pendentes_idx
       ON contact_events (processed_at, created_at)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS contact_events_contato_idx
       ON contact_events (contact_id, created_at)`
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
