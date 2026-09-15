import { config } from "dotenv";
import { Client } from "pg";

// O casamento por TELEFONE com o Pipedrive (15/09/2026, pedido do usuário).
//
// A sincronização sempre tentou casar o lead pelo telefone quando o e-mail
// não batia — e nunca conseguiu: a biblioteca de telefone morria sob tsx, que
// é como o worker roda, e a passada caía para "só e-mail" com um aviso no log.
// Na releitura de 15/09, 1.589 dos 1.811 negócios dos dois funis ficaram sem
// contato. lib/phone.ts agora entrega a tabela de números explicitamente e o
// telefone funciona no worker, casando cada número da pessoa, com e sem o nono
// dígito.
//
// Não há dado a mudar aqui: só apagar as marcas-d'água, para a passada seguinte
// reler os funis e aplicar o casamento também aos negócios que não mudaram
// desde a última leitura.
//
// Rode uma vez: `npx tsx scripts/migrate-sincroniza-funil-telefone.ts`

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

const MARCADOR = "pipedrive_casamento_telefone";

async function main() {
  await client.connect();

  const { rows: feito } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [MARCADOR]
  );
  if (feito.length > 0) {
    console.log("[MIGRATE] Casamento por telefone já migrado.");
    await client.end();
    process.exit(0);
  }

  await client.query("BEGIN");

  const { rowCount: marcas } = await client.query(
    `DELETE FROM app_settings
      WHERE key = 'pipedrive_sync_desde' OR key LIKE 'pipedrive_sync_desde:%'`
  );
  console.log(
    `[MIGRATE] ${marcas ?? 0} marca(s)-d'água apagada(s) — a próxima sincronização relê os funis casando também por telefone`
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
