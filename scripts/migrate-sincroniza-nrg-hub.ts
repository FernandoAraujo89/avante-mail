import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: o espelho de negócios (`pipedrive_deals`) passa a
// guardar ids em TEXTO — o NRG Hub usa UUIDs, o Pipedrive usava números (que
// viram "123"; nada se perde). Roda DEPOIS de migrate-sincroniza-funil-*.ts
// (ordem alfabética do loop do deploy), que cria a tabela com integer.
// docs/plano-webhooks-leads.md, "Sincronização com o NRG Hub".

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
  for (const coluna of ["id", "pipeline_id", "person_id"]) {
    const { rows } = await client.query(
      `select data_type from information_schema.columns
        where table_name = 'pipedrive_deals' and column_name = $1`,
      [coluna]
    );
    const tipo = rows[0]?.data_type as string | undefined;
    if (!tipo) {
      console.log(`[MIGRATE] pipedrive_deals.${coluna}: tabela ainda não existe — nada a fazer.`);
      continue;
    }
    if (tipo === "text") {
      console.log(`[MIGRATE] pipedrive_deals.${coluna}: já é text.`);
      continue;
    }
    console.log(`[MIGRATE] pipedrive_deals.${coluna}: ${tipo} → text...`);
    await client.query(
      `ALTER TABLE pipedrive_deals ALTER COLUMN ${coluna} TYPE text USING ${coluna}::text`
    );
  }
  console.log("[MIGRATE] contacts.crm_funil (funil do lead no CRM)...");
  await client.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS crm_funil text`);

  console.log("[MIGRATE] sincronização com o NRG Hub: concluído.");
}

main()
  .catch((error) => {
    console.error("[MIGRATE] erro:", error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
