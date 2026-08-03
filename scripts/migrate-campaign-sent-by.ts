import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: registra quem disparou cada campanha.
// sent_by_user_id liga ao usuário (vira NULL se a conta for removida) e
// sent_by_name guarda o nome do momento do envio, para o relatório continuar
// dizendo quem enviou mesmo depois de a conta sumir.
// Campanhas antigas ficam com NULL — o relatório mostra "não registrado".
// Rode uma vez: `npx tsx scripts/migrate-campaign-sent-by.ts`

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

  console.log("[MIGRATE] campaigns: quem disparou...");
  await client.query(
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sent_by_user_id uuid
       REFERENCES users(id) ON DELETE SET NULL`
  );
  await client.query(
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sent_by_name text`
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
