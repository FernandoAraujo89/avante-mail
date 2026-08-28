import { config } from "dotenv";
import { Client } from "pg";

// Rastreio anônimo + costura (fase E.2).
//
// O rastreio da fase E só coletava quem JÁ estava identificado (token do
// clique de e-mail) — e ficou meses em zero, porque nenhum lead recebeu
// e-mail. O que as plataformas de referência fazem, e esta fase traz: coletar
// o visitante anônimo desde a primeira página (identificador próprio, sem
// assinatura) e COSTURAR o histórico na ficha quando a identidade aparecer —
// pelo token do e-mail ou pelo campo oculto `av_visitante` do formulário,
// que chega pelo webhook. A visita de antes do e-mail passa a existir.
//
// Rode uma vez: `npx tsx scripts/migrate-rastreio-anonimo.ts`

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

const MARCADOR = "rastreio_anonimo";

async function main() {
  await client.connect();

  const { rows: feito } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [MARCADOR]
  );
  if (feito.length > 0) {
    console.log("[MIGRATE] Rastreio anônimo já migrado.");
    await client.end();
    process.exit(0);
  }

  await client.query("BEGIN");

  console.log("[MIGRATE] anonymous_site_events...");
  await client.query(
    `CREATE TABLE IF NOT EXISTS anonymous_site_events (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       visitor_id text NOT NULL,
       type text NOT NULL,
       payload jsonb NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  // A costura lê por visitante; a limpeza, por idade.
  await client.query(
    `CREATE INDEX IF NOT EXISTS anonymous_site_events_visitor_idx
       ON anonymous_site_events (visitor_id, created_at)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS anonymous_site_events_idade_idx
       ON anonymous_site_events (created_at)`
  );

  // A MESMA deduplicação do contact_events, por visitante: uma visita por
  // sessão, um evento nomeado por sessão. Sem isto, F5 e duas abas dobrariam
  // os pontos futuros — a costura carrega o histórico como está.
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS anonymous_site_events_sessao_idx
       ON anonymous_site_events (
         visitor_id, type, (payload->>'sessao'), (coalesce(payload->>'evento',''))
       )`
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
