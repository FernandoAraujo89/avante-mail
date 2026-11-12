import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: o MOTIVO DA PERDA dos negócios do CRM, para o
// remarketing dos leads perdidos (12/11/2026).
//
// - pipedrive_deals.motivo_perda / fechado_em: o que a API do NRG Hub manda em
//   cada negócio (`motivo_perda`, `fechado_em`) e que até aqui era descartado.
// - contacts.crm_motivo_perda / crm_perdido_em: o motivo e a data no LEAD,
//   preenchidos pela sincronização quando todos os negócios dele estão
//   perdidos; limpos quando ele volta a ter negócio aberto ou ganho.
//
// Só acrescenta colunas vazias — nada do que existe muda. Roda DEPOIS de
// migrate-sincroniza-funil-*.ts e migrate-sincroniza-nrg-hub.ts (ordem
// alfabética do loop do deploy), que criam a tabela de negócios.
//
// No fim, adianta a releitura diária completa do NRG Hub (apaga a marca da
// última): a passada seguinte relê todos os negócios e já traz o motivo dos
// que estavam perdidos antes desta migração. Sem isso eles chegariam sozinhos,
// mas só na próxima releitura (até 20 horas depois).

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

  const { rows } = await client.query(
    `select 1 from information_schema.tables where table_name = 'pipedrive_deals'`
  );
  if (rows.length === 0) {
    console.log("[MIGRATE] pipedrive_deals ainda não existe — nada a fazer nos negócios.");
  } else {
    console.log("[MIGRATE] pipedrive_deals.motivo_perda / fechado_em...");
    await client.query(`ALTER TABLE pipedrive_deals ADD COLUMN IF NOT EXISTS motivo_perda text`);
    await client.query(
      `ALTER TABLE pipedrive_deals ADD COLUMN IF NOT EXISTS fechado_em timestamp with time zone`
    );
  }

  console.log("[MIGRATE] contacts.crm_motivo_perda / crm_perdido_em...");
  await client.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS crm_motivo_perda text`);
  await client.query(
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS crm_perdido_em timestamp with time zone`
  );

  // Uma vez só: depois que o motivo já foi lido, a marca não é apagada de novo
  // (senão cada deploy forçaria uma releitura completa sem necessidade).
  const { rows: jaLido } = await client.query(
    `select 1 from pipedrive_deals where motivo_perda is not null limit 1`
  ).catch(() => ({ rows: [{}] }));
  if (jaLido.length === 0) {
    const apagadas = await client.query(
      `delete from app_settings where key = 'nrg_releitura_ultima'`
    );
    console.log(
      `[MIGRATE] releitura completa do NRG Hub adiantada (${apagadas.rowCount ?? 0} marca apagada).`
    );
  }

  console.log("[MIGRATE] motivo da perda: concluído.");
}

main()
  .catch((error) => {
    console.error("[MIGRATE] erro:", error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
