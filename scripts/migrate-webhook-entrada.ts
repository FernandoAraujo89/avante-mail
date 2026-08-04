import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: entrada de leads por webhook (fase A do
// docs/plano-webhooks-leads.md).
//  - contacts: estágio do funil e origem da aquisição (UTMs);
//  - webhook_sources: quem pode nos chamar, com token e mapeamento;
//  - webhook_deliveries: tudo que chegou, para auditoria e reprocessamento.
// Nada existente muda de comportamento — sem origem cadastrada, o endpoint
// recusa tudo com 404.
// Rode uma vez: `npx tsx scripts/migrate-webhook-entrada.ts`

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

  console.log("[MIGRATE] contacts: estágio e origem do lead...");
  const colunas = [
    ["stage", "text"],
    ["source_channel", "text"],
    ["utm_source", "text"],
    ["utm_medium", "text"],
    ["utm_campaign", "text"],
    ["utm_content", "text"],
    ["utm_term", "text"],
    ["landing_page", "text"],
    ["referrer", "text"],
    ["source_detail", "text"],
    ["acquired_at", "timestamptz"],
  ];
  for (const [nome, tipo] of colunas) {
    await client.query(
      `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ${nome} ${tipo}`
    );
  }
  // Filtro da área de gestão: só os leads.
  await client.query(
    `CREATE INDEX IF NOT EXISTS contacts_stage_idx ON contacts (stage)
       WHERE stage IS NOT NULL`
  );

  console.log("[MIGRATE] webhook_sources...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS webhook_sources (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      token_hash text NOT NULL,
      mapping jsonb,
      defaults jsonb,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS webhook_sources_slug_idx ON webhook_sources (slug)`
  );

  console.log("[MIGRATE] webhook_deliveries...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_id uuid NOT NULL REFERENCES webhook_sources(id) ON DELETE CASCADE,
      payload_hash text NOT NULL,
      payload jsonb,
      status text NOT NULL,
      contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
      resultado jsonb,
      erro text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS webhook_deliveries_origem_idx
       ON webhook_deliveries (source_id, created_at)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS webhook_deliveries_repeticao_idx
       ON webhook_deliveries (source_id, payload_hash, created_at)`
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
