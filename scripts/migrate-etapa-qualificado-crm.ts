import { config } from "dotenv";
import { Client } from "pg";

// A etapa de entrada muda de nome: "Qualificado pelo agente" → "Qualificado
// no CRM". Quem qualifica é o VENDEDOR (SDR), no Pipedrive — é qualificação do
// time comercial, não do marketing, e o nome antigo atribuía a ação à pessoa
// errada. O slug (`qualificado`) não muda: é ele que os leads carregam.
//
// Só renomeia se o rótulo ainda for o antigo — uma edição manual feita pela
// tela não é sobrescrita.
//
// Rode uma vez: `npx tsx scripts/migrate-etapa-qualificado-crm.ts`

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

const MARCADOR = "etapa_qualificado_crm";

async function main() {
  await client.connect();

  const { rows: feito } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [MARCADOR]
  );
  if (feito.length > 0) {
    console.log("[MIGRATE] Etapa já renomeada.");
    await client.end();
    process.exit(0);
  }

  const { rowCount } = await client.query(
    `UPDATE lead_stages SET label = 'Qualificado no CRM', updated_at = now()
      WHERE slug = 'qualificado' AND label = 'Qualificado pelo agente'`
  );
  console.log(
    `[MIGRATE] "Qualificado pelo agente" → "Qualificado no CRM": ${rowCount ? "renomeada" : "já estava com outro nome — mantida"}`
  );

  await client.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, 'true')
     ON CONFLICT (key) DO UPDATE SET value = 'true'`,
    [MARCADOR]
  );

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
