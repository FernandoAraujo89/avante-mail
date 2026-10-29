import { config } from "dotenv";
import { Client } from "pg";

import { recriarRestricaoDeOrigem } from "../lib/db/origem-de-envio";

// Migração idempotente: convites e lembretes de pesquisa como terceira origem
// de campaign_sends (docs/plano-expansao.md, parte 4). Roda DEPOIS de
// migrate-campaign-sends-origem.ts e migrate-pesquisas.ts (ordem alfabética
// do loop do deploy) — e refaz a restrição de origem com a cláusula nova,
// porque aquele script a recria sem ela a cada deploy.

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

  console.log("[MIGRATE] campaign_sends: colunas da pesquisa...");
  await client.query(
    `ALTER TABLE campaign_sends
       ADD COLUMN IF NOT EXISTS survey_invite_id uuid REFERENCES survey_invites(id) ON DELETE CASCADE`
  );
  await client.query(
    `ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS survey_message_kind text`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS campaign_sends_pesquisa_idx
       ON campaign_sends (survey_invite_id) WHERE survey_invite_id IS NOT NULL`
  );

  console.log("[MIGRATE] campaign_sends: restrição de origem com a pesquisa...");
  // Mesma definição das outras duas migrações (lib/db/origem-de-envio.ts).
  const expressao = await recriarRestricaoDeOrigem(client);
  console.log(`[MIGRATE]   CHECK (${expressao})`);

  console.log("[MIGRATE] Concluído.");
  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
