import { config } from "dotenv";
import { Client } from "pg";

// Backfill pontual: marca o consentimento de WhatsApp para todos os contatos
// que já têm telefone cadastrado.
//
// NÃO é uma migração — o nome não casa com `migrate-*`, então o deploy não o
// executa. É de propósito: rodar a cada deploy reverteria as decisões tomadas
// depois (um contato importado de propósito sem opt-in voltaria a receber).
// Para aplicar de novo (ex.: depois de uma importação grande), rode à mão.
//
// TRAVA DE SEGURANÇA: quem já saiu do canal — `whatsapp_opt_out_at` preenchido,
// seja porque respondeu SAIR no WhatsApp (webhook) ou porque foi desmarcado na
// tela do contato — NUNCA é reinscrito. Voltar a enviar para quem pediu para
// sair viola a política da Meta e derruba a qualidade (ou o número).
//
// Rode: `npx tsx scripts/backfill-whatsapp-consent.ts`

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[BACKFILL] DATABASE_URL não definida no .env.local.");
  process.exit(1);
}

const needsSsl = /sslmode=require|neon\.tech/.test(url);
const client = new Client({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  await client.connect();

  const { rows: before } = await client.query<{
    com_telefone: string;
    ja_com_consentimento: string;
    opt_out: string;
  }>(`
    SELECT
      count(*) FILTER (WHERE phone IS NOT NULL) AS com_telefone,
      count(*) FILTER (WHERE phone IS NOT NULL AND whatsapp_subscribed) AS ja_com_consentimento,
      count(*) FILTER (WHERE phone IS NOT NULL AND whatsapp_opt_out_at IS NOT NULL) AS opt_out
    FROM contacts
  `);

  const stats = before[0];
  console.log(`[BACKFILL] Contatos com telefone: ${stats.com_telefone}`);
  console.log(`[BACKFILL]   já com consentimento: ${stats.ja_com_consentimento}`);
  console.log(`[BACKFILL]   preservados (opt-out): ${stats.opt_out}`);

  // O opt_in_at só é preenchido quando ainda não existe: se o contato já tinha
  // uma data de consentimento registrada, ela é a prova original (LGPD).
  const { rowCount } = await client.query(`
    UPDATE contacts
       SET whatsapp_subscribed = true,
           whatsapp_opt_in_at = coalesce(whatsapp_opt_in_at, now())
     WHERE phone IS NOT NULL
       AND whatsapp_subscribed = false
       AND whatsapp_opt_out_at IS NULL
  `);

  console.log(`[BACKFILL] Contatos atualizados: ${rowCount}`);
  console.log("[BACKFILL] Concluído.");

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[BACKFILL] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
