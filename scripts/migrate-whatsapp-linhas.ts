import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: linhas de WhatsApp (docs/plano-expansao.md, parte 5).
// A conversa passa a ser única por (linha, telefone); as existentes são do
// número de comunicados. Roda DEPOIS de migrate-whatsapp-conversas.ts (ordem
// alfabética do loop do deploy), que cria a tabela com o UNIQUE antigo.

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

  console.log("[MIGRATE] whatsapp_conversations.line...");
  await client.query(
    `ALTER TABLE whatsapp_conversations
       ADD COLUMN IF NOT EXISTS line text NOT NULL DEFAULT 'comunicados'`
  );

  console.log("[MIGRATE] Conversa única por (linha, telefone)...");
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversations_linha_telefone_idx
       ON whatsapp_conversations (line, phone)`
  );
  // O UNIQUE antigo só por telefone impediria a segunda linha de ter a
  // conversa do mesmo parceiro.
  await client.query(
    `ALTER TABLE whatsapp_conversations
       DROP CONSTRAINT IF EXISTS whatsapp_conversations_phone_unique`
  );
  await client.query(`DROP INDEX IF EXISTS whatsapp_conversations_phone_unique`);

  console.log("[MIGRATE] Concluído.");
  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
