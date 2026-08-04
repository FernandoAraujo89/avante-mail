import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: separa "pediu para sair" de "nunca deu aceite".
//
// `subscribed = false` significava as duas coisas, e o motor das automações
// parava o percurso nas duas — o que impedia QUALQUER lead novo de ser
// nutrido, já que lead entra sem aceite.
//
// email_opt_out_at preenchido = e-mail suprimido (descadastro, devolução
// definitiva ou reclamação de spam) → automação para.
// Nulo com subscribed = false = nunca consentiu → automação segue, e o passo
// de envio é que recusa.
//
// BACKFILL: quem já está fora hoje é tratado como suprimido. É a direção
// segura — na dúvida, parar o fluxo em vez de voltar a mandar mensagem para
// quem talvez tenha pedido para sair.
// Rode uma vez: `npx tsx scripts/migrate-email-opt-out.ts`

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

  console.log("[MIGRATE] contacts: email_opt_out_at...");
  await client.query(
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_opt_out_at timestamptz`
  );

  // Só quem já estava fora ANTES desta coluna existir. Rodar de novo não
  // remarca ninguém.
  const { rowCount } = await client.query(
    `UPDATE contacts SET email_opt_out_at = now()
      WHERE subscribed = false AND email_opt_out_at IS NULL`
  );
  console.log(`[MIGRATE] Marcados como suprimidos: ${rowCount}`);

  console.log("[MIGRATE] Concluído.");

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
