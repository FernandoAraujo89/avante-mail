import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: Lead Score (fase C do docs/plano-webhooks-leads.md).
//  - contacts: pontuação, faixa e quando a conta foi feita;
//  - lead_score_rules: o modelo de pontuação, em tabela para o time mexer nos
//    pesos sem deploy — é o que vão querer fazer depois de ver o score rodando
//    com dados reais.
// A pontuação nasce NULA e é preenchida pelo worker no primeiro ciclo; nada
// muda de comportamento até isso acontecer.
// Rode uma vez: `npx tsx scripts/migrate-lead-score.ts`

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

// Espelha REGRAS_PADRAO de lib/leads/score.ts. Semeadas só se a tabela estiver
// vazia — repetir a migração não desfaz o que o time ajustou na tela.
const REGRAS = [
  ["contact_created", 10, "Entrou como lead"],
  ["email_opened", 2, "Abriu um e-mail"],
  ["email_clicked", 5, "Clicou num e-mail"],
  ["whatsapp_replied", 15, "Respondeu no WhatsApp"],
  ["email_unsubscribed", -30, "Descadastrou-se do e-mail"],
  ["whatsapp_unsubscribed", -30, "Pediu para sair do WhatsApp"],
  ["tag_added", 1, "Ganhou uma tag"],
] as const;

async function main() {
  await client.connect();

  console.log("[MIGRATE] contacts: pontuação do lead...");
  for (const [nome, tipo] of [
    ["lead_score", "integer"],
    ["lead_score_band", "text"],
    ["lead_score_at", "timestamptz"],
  ]) {
    await client.query(
      `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ${nome} ${tipo}`
    );
  }
  // A área de Leads ordena e filtra por faixa; só os leads têm pontuação.
  await client.query(
    `CREATE INDEX IF NOT EXISTS contacts_lead_score_idx
       ON contacts (lead_score_band, lead_score DESC)
     WHERE stage IS NOT NULL`
  );

  console.log("[MIGRATE] lead_score_rules...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS lead_score_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type text NOT NULL UNIQUE,
      points integer NOT NULL,
      active boolean NOT NULL DEFAULT true,
      description text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await client.query(`SELECT count(*)::int AS n FROM lead_score_rules`);
  if (rows[0].n === 0) {
    for (const [evento, pontos, descricao] of REGRAS) {
      await client.query(
        `INSERT INTO lead_score_rules (event_type, points, description)
         VALUES ($1, $2, $3) ON CONFLICT (event_type) DO NOTHING`,
        [evento, pontos, descricao]
      );
    }
    console.log(`[MIGRATE] ${REGRAS.length} regras semeadas.`);
  } else {
    console.log(`[MIGRATE] Regras já existem (${rows[0].n}) — nada a semear.`);
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
