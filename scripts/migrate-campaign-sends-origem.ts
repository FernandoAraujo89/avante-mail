import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: corrige a restrição de origem de campaign_sends.
//
// A restrição criada na fase 2 exigia campanha OU percurso. Só que a chave
// estrangeira do percurso é ON DELETE SET NULL — de propósito, para o histórico
// de envio (e o custo já pago) sobreviver à remoção da automação. As duas
// regras se contradiziam: apagar uma automação que já tinha enviado zerava o
// automation_run_id e a linha passava a violar a própria restrição, então o
// DELETE falhava com erro de constraint.
//
// A restrição agora aceita também o passo (automation_step_id, que não tem FK e
// permanece na linha). Continua barrando o que ela existia para barrar: envio
// gravado sem origem nenhuma — cobrado e invisível em qualquer relatório.
//
// Rode uma vez: `npx tsx scripts/migrate-campaign-sends-origem.ts`

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

  console.log("[MIGRATE] campaign_sends: restrição de origem...");
  await client.query(
    `ALTER TABLE campaign_sends
       DROP CONSTRAINT IF EXISTS campaign_sends_origem_check`
  );
  await client.query(`
    ALTER TABLE campaign_sends ADD CONSTRAINT campaign_sends_origem_check
      CHECK (
        campaign_id IS NOT NULL
        OR automation_run_id IS NOT NULL
        OR automation_step_id IS NOT NULL
      )
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
