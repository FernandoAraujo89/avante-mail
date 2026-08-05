import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: a quarta faixa do Lead Score ("aquecido").
//
// A escala virou Frio → Morno → Aquecido → Quente. O limiar que antes era o de
// QUENTE passa a ser o de AQUECIDO, e "quente" sobe para o dobro. Sem esta
// migração, quem já tivesse ajustado o corte na tela veria o significado do
// próprio número mudar por baixo: um lead de 60 pontos, que ontem era quente,
// amanheceria aquecido sem ninguém ter mexido em nada.
//
// Também recalcula as faixas gravadas em contacts — elas guardam o RÓTULO, e
// um rótulo calculado com a régua antiga fica errado até a próxima passagem.
//
// Rode uma vez: `npx tsx scripts/migrate-faixa-aquecido.ts`

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

const CHAVE_MORNO = "lead_score_faixa_morno";
const CHAVE_AQUECIDO = "lead_score_faixa_aquecido";
const CHAVE_QUENTE = "lead_score_faixa_quente";
const MARCADOR = "lead_score_faixa_aquecido_migrada";

const PADRAO_MORNO = 20;
const PADRAO_AQUECIDO = 50;

async function ler(chave: string): Promise<number | null> {
  const { rows } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [chave]
  );
  const n = Number(rows[0]?.value);
  return Number.isFinite(n) ? n : null;
}

async function gravar(chave: string, valor: number): Promise<void> {
  await client.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [chave, String(valor)]
  );
}

async function main() {
  await client.connect();

  const { rows: feito } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [MARCADOR]
  );
  if (feito.length > 0) {
    console.log("[MIGRATE] Faixa 'aquecido' já migrada — preservando a edição.");
    await client.end();
    process.exit(0);
  }

  await client.query("BEGIN");

  // O corte de "quente" de antes vira o de "aquecido". Se nunca foi
  // configurado, o padrão antigo (50) é o que estava valendo na prática.
  const quenteAntigo = (await ler(CHAVE_QUENTE)) ?? PADRAO_AQUECIDO;
  await gravar(CHAVE_AQUECIDO, quenteAntigo);
  // "Quente" sobe para o dobro: é o topo da escala, e mantém a barra de calor
  // enchendo exatamente quando o lead chega no novo topo.
  await gravar(CHAVE_QUENTE, quenteAntigo * 2);
  console.log(
    `[MIGRATE] Faixas: aquecido = ${quenteAntigo}, quente = ${quenteAntigo * 2}`
  );

  const morno = (await ler(CHAVE_MORNO)) ?? PADRAO_MORNO;

  // Reclassifica quem já tem pontuação. Sem isto o rótulo gravado contradiz a
  // régua nova até a passagem diária do worker — e a tela mostraria "quente"
  // para quem, pela régua atual, é só aquecido.
  const { rowCount } = await client.query(
    `UPDATE contacts SET lead_score_band =
        CASE
          WHEN lead_score >= $1 THEN 'quente'
          WHEN lead_score >= $2 THEN 'aquecido'
          WHEN lead_score >= $3 THEN 'morno'
          ELSE 'frio'
        END
      WHERE lead_score IS NOT NULL`,
    [quenteAntigo * 2, quenteAntigo, morno]
  );
  console.log(`[MIGRATE] Leads reclassificados: ${rowCount ?? 0}`);

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
