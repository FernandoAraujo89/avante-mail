import { config } from "dotenv";
import { Client } from "pg";

// A etapa "Perdido" (15/09/2026, pedido do usuário).
//
// A sincronização sempre soube o que fazer com negócio PERDIDO no Pipedrive —
// mandar o lead para a etapa `perdido` — mas só se ela existisse. Sem ela, o
// lead ficava parado na última etapa, com os pontos dela; e a maioria dos
// negócios dos dois funis acompanhados termina perdida.
//
//   - Posição 110, depois de "Comprou": no painel ela aparece no fim, como a
//     outra saída. O relatório a deixa FORA da sequência do funil (senão quem
//     perdeu contaria como tendo chegado até "Comprou") e a conta à parte.
//   - NÃO encerra a nutrição: perder o negócio não é pedir para sair, e
//     nutrir é o que este sistema faz — é o lead que mais precisa de uma
//     trilha de recuperação. É uma caixa na tela, se o time decidir o
//     contrário.
//   - 0 pontos: a posição no funil deixa de somar (o lead perde os pontos da
//     etapa em que estava, porque vale só a atual); o que ele faz — visita,
//     resposta — e a qualificação continuam contando.
//   - As marcas-d'água são apagadas de novo: a passada seguinte relê os funis
//     e aplica os negócios que já estavam perdidos.
//
// Rode uma vez: `npx tsx scripts/migrate-sincroniza-funil-perdido.ts`

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

const MARCADOR = "etapa_perdido";

async function main() {
  await client.connect();

  const { rows: feito } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [MARCADOR]
  );
  if (feito.length > 0) {
    console.log("[MIGRATE] Etapa Perdido já migrada.");
    await client.end();
    process.exit(0);
  }

  await client.query("BEGIN");

  const { rowCount: criada } = await client.query(
    `INSERT INTO lead_stages (slug, label, position, stops_nurturing)
     VALUES ('perdido', 'Perdido', 110, false)
     ON CONFLICT (slug) DO NOTHING`
  );
  console.log(
    `[MIGRATE] etapa Perdido: ${criada ? "criada (posição 110, não encerra a nutrição)" : "já existia — mantida como estava"}`
  );

  const { rowCount: regra } = await client.query(
    `INSERT INTO lead_score_rules (event_type, condition, points, description)
     VALUES ('lead_stage_changed', '{"para":"perdido"}'::jsonb, 0, 'Chegou em Perdido')
     ON CONFLICT DO NOTHING`
  );
  console.log(
    `[MIGRATE] pontos de Perdido: ${regra ? "0" : "já tinha regra — preservada"}`
  );

  const { rowCount: marcas } = await client.query(
    `DELETE FROM app_settings
      WHERE key = 'pipedrive_sync_desde' OR key LIKE 'pipedrive_sync_desde:%'`
  );
  console.log(
    `[MIGRATE] ${marcas ?? 0} marca(s)-d'água apagada(s) — a próxima sincronização aplica os negócios perdidos`
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
