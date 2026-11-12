import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente e só aditiva: os números de WhatsApp que não são linhas
// do Campanhas (os de outros sistemas, como o NRG Hub) ganham uma tabela para
// a tela mostrar o número e o nome de cada um. As conversas desses números
// usam a coluna `line` que já existe (`outros:<phone_number_id>`), sem mexer no
// índice único (line, phone) — o app antigo, que roda durante as migrações do
// deploy, continua gravando as conversas como sempre.

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

  console.log("[MIGRATE] whatsapp_outros_numeros...");
  await client.query(
    `CREATE TABLE IF NOT EXISTS whatsapp_outros_numeros (
       phone_number_id text PRIMARY KEY,
       display_phone_number text,
       verified_name text,
       first_seen_at timestamptz NOT NULL DEFAULT now()
     )`
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
