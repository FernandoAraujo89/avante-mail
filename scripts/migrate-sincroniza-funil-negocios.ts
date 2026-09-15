import { config } from "dotenv";
import { Client } from "pg";

// A etapa do lead passa a ser decidida por TODOS os negócios dele (15/09/2026).
//
// Com "vale o negócio que mudou por último", o lead com um negócio perdido e
// outro aberto ia para Perdido e voltava na mesma passada — e cada releitura
// repetia a ida e a volta na linha do tempo e nas automações (25 leads no dia
// em que o telefone passou a casar). A regra nova (lib/pipedrive/regra.ts):
// ganho vira Comprou; havendo negócio aberto, vale o aberto mais adiantado no
// funil; Perdido só quando todos estão perdidos.
//
// Para decidir pelo conjunto, a sincronização precisa lembrar dos negócios que
// não mudaram nesta passada: `pipedrive_deals` é esse espelho, com o lead que
// cada negócio casou.
//
// As marcas-d'água são apagadas: a passada seguinte relê os funis, preenche o
// espelho e decide cada lead uma vez — quem está oscilando para na etapa certa.
//
// Rode uma vez: `npx tsx scripts/migrate-sincroniza-funil-negocios.ts`

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

const MARCADOR = "pipedrive_espelho_negocios";

async function main() {
  await client.connect();

  const { rows: feito } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [MARCADOR]
  );
  if (feito.length > 0) {
    console.log("[MIGRATE] Espelho dos negócios já migrado.");
    await client.end();
    process.exit(0);
  }

  await client.query("BEGIN");

  console.log("[MIGRATE] pipedrive_deals...");
  await client.query(
    `CREATE TABLE IF NOT EXISTS pipedrive_deals (
       id integer PRIMARY KEY,
       pipeline_id integer NOT NULL,
       stage_name text,
       status text NOT NULL,
       person_id integer,
       contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
       qualificacao text,
       update_time text NOT NULL,
       lido_em timestamptz NOT NULL DEFAULT now()
     )`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS pipedrive_deals_contato_idx
       ON pipedrive_deals (contact_id)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS pipedrive_deals_funil_idx
       ON pipedrive_deals (pipeline_id, lido_em)`
  );

  const { rowCount: marcas } = await client.query(
    `DELETE FROM app_settings
      WHERE key = 'pipedrive_sync_desde'
         OR key LIKE 'pipedrive_sync_desde:%'
         OR key LIKE 'pipedrive_releitura_%'`
  );
  console.log(
    `[MIGRATE] ${marcas ?? 0} marca(s) apagada(s) — a próxima sincronização relê os funis e decide cada lead por todos os negócios`
  );

  await client.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, 'true')
     ON CONFLICT (key) DO UPDATE SET value = 'true'`,
    [MARCADOR]
  );

  await client.query("COMMIT");
  console.log("[MIGRATE] Concluído.");

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  await client.query("ROLLBACK").catch(() => {});
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
