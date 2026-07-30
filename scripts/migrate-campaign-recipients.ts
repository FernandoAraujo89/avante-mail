import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: destinatários escolhidos à mão na campanha.
// campaigns.recipient_ids = NULL  -> todos os contatos elegíveis das listas/tags
//                                    (comportamento de sempre, e o das campanhas
//                                    já existentes);
// campaigns.recipient_ids = uuid[] -> envia só para esses contatos.
// A elegibilidade continua valendo em cima disso: descadastrado/opt-out não
// recebe nem se estiver na lista escolhida.
// Rode uma vez: `npx tsx scripts/migrate-campaign-recipients.ts`

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

  console.log("[MIGRATE] campaigns: destinatários escolhidos à mão...");
  await client.query(
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recipient_ids uuid[]`
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
