import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: os estágios do lead passam a descrever NUTRIÇÃO, não
// funil de vendas.
//
// POR QUÊ: o comercial trabalha no Pipedrive, sem integração com aqui. Estágios
// de venda (novo/contatado/qualificado) só seriam preenchidos por quem tem a
// informação — e essa pessoa está na outra ferramenta. Ficariam eternamente
// desatualizados, afirmando um estado de venda que ninguém aqui conhece.
//
// A régua nova:
//   novo, contatado, qualificado → nutrindo    (todos estavam sendo nutridos)
//   convertido                   → cliente     (o comercial fechou)
//   perdido                      → descartado  (não era oportunidade)
//
// Rode uma vez: `npx tsx scripts/migrate-estagios-nutricao.ts`

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

const MARCADOR = "lead_estagios_nutricao_migrados";

const DE_PARA: [string, string][] = [
  ["novo", "nutrindo"],
  ["contatado", "nutrindo"],
  ["qualificado", "nutrindo"],
  ["convertido", "cliente"],
  ["perdido", "descartado"],
];

async function main() {
  await client.connect();

  const { rows: feito } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [MARCADOR]
  );
  if (feito.length > 0) {
    console.log("[MIGRATE] Estágios já migrados.");
    await client.end();
    process.exit(0);
  }

  await client.query("BEGIN");

  console.log("[MIGRATE] contacts: data da entrega ao comercial...");
  await client.query(
    `ALTER TABLE contacts
       ADD COLUMN IF NOT EXISTS enviado_ao_comercial_em timestamptz`
  );

  let movidos = 0;
  for (const [de, para] of DE_PARA) {
    const r = await client.query(
      `UPDATE contacts SET stage = $1 WHERE stage = $2`,
      [para, de]
    );
    if (r.rowCount) {
      console.log(`[MIGRATE]   ${de} → ${para}: ${r.rowCount}`);
      movidos += r.rowCount;
    }
  }
  console.log(`[MIGRATE] Leads reclassificados: ${movidos}`);

  // Quem já foi marcado como entregue no modelo antigo não tem data. Usar o
  // "agora" seria inventar um fato; deixar nulo é honesto — a tela mostra
  // "sem data registrada" em vez de uma data falsa.
  //
  // As ORIGENS de webhook carregam o estágio de entrada nos seus defaults.
  // Sem isto, todo lead novo entraria com um estágio que não existe mais e a
  // área de Leads o mostraria fora de qualquer coluna do funil.
  const { rowCount: origens } = await client.query(
    `UPDATE webhook_sources
        SET defaults = jsonb_set(coalesce(defaults, '{}'::jsonb), '{stage}', '"nutrindo"')
      WHERE coalesce(defaults->>'stage', '') IN ('novo','contatado','qualificado','')`
  );
  console.log(`[MIGRATE] Origens de webhook ajustadas: ${origens ?? 0}`);

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
