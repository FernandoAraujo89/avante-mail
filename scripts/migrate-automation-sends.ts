import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: campaign_sends genérica (Fase 2 do
// docs/plano-automacoes.md).
//
// O envio deixa de ser exclusivo de campanha e passa a servir também aos
// passos de automação: campaign_id vira anulável e entram automation_run_id,
// automation_step_id e channel.
//
// Nada existente muda de comportamento — as linhas antigas continuam com
// campaign_id preenchido, e o channel é preenchido a partir do canal da
// campanha de origem.
//
// Rode uma vez: `npx tsx scripts/migrate-automation-sends.ts`

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

  console.log("[MIGRATE] campaign_sends: colunas da automação...");
  await client.query(
    `ALTER TABLE campaign_sends ALTER COLUMN campaign_id DROP NOT NULL`
  );
  await client.query(
    `ALTER TABLE campaign_sends
       ADD COLUMN IF NOT EXISTS automation_run_id uuid
         REFERENCES automation_runs(id) ON DELETE SET NULL`
  );
  await client.query(
    `ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS automation_step_id uuid`
  );
  await client.query(
    `ALTER TABLE campaign_sends
       ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email'`
  );

  // Envios antigos: o canal vem da campanha de origem. Só os de WhatsApp
  // precisam de correção — o default já cobre o resto.
  console.log("[MIGRATE] preenchendo o canal dos envios existentes...");
  const canal = await client.query(
    `UPDATE campaign_sends s
        SET channel = c.channel
       FROM campaigns c
      WHERE c.id = s.campaign_id AND s.channel <> c.channel`
  );
  console.log(`[MIGRATE]   ${canal.rowCount} envio(s) ajustado(s).`);

  console.log("[MIGRATE] índices e restrição de origem...");
  await client.query(
    `CREATE INDEX IF NOT EXISTS campaign_sends_automacao_idx
       ON campaign_sends (automation_run_id)`
  );
  // Um passo de envio manda UMA vez por percurso: trava contra o job repetido
  // (retry depois de gravar o envio, antes de avançar o percurso) virar
  // mensagem duplicada.
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS campaign_sends_automacao_passo_idx
       ON campaign_sends (automation_run_id, automation_step_id)
       WHERE automation_run_id IS NOT NULL`
  );
  // Envio sem origem nenhuma é lixo silencioso: não aparece em relatório
  // nenhum, mas foi cobrado. A restrição impede que exista.
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'campaign_sends_origem_check'
      ) THEN
        ALTER TABLE campaign_sends ADD CONSTRAINT campaign_sends_origem_check
          CHECK (campaign_id IS NOT NULL OR automation_run_id IS NOT NULL);
      END IF;
    END $$;
  `);

  console.log("[MIGRATE] Concluído.");

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
