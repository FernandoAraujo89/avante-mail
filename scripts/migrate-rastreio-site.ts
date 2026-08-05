import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: rastreio do site (fase E do docs/plano-webhooks-leads.md).
//
// Três mudanças, e a ORDEM importa:
//  1. lead_score_rules ganha `condition` e PERDE o UNIQUE de event_type — dois
//     pesos para o mesmo `site_event` ("viu preços" e "pediu demonstração")
//     dependem disso.
//  2. site_event_rules: a tradução caminho → evento, no servidor.
//  3. índice de deduplicação em contact_events: um `site_visited` por sessão.
//     Sem ele um lead que abre 20 páginas ganha 20x os pontos e passa na frente
//     de quem pediu demonstração — o modelo se corromperia sozinho.
//
// Rode uma vez: `npx tsx scripts/migrate-rastreio-site.ts`
// (o deploy roda todos os migrate-*.ts a cada subida, então idempotência aqui
// é requisito, não zelo).

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

/** Regras de pontuação do site (§6.2 do plano). */
const REGRAS_DE_SITE = [
  ["site_visited", null, 3, "Visitou o site"],
  ["site_event", '{"evento":"precos"}', 10, "Viu a página de preços"],
  ["site_event", '{"evento":"demo"}', 25, "Pediu demonstração"],
] as const;

/** Páginas que viram evento nomeado. Ponto de partida, editável na tela. */
const PAGINAS = [
  ["precos", "prefixo", "/planos", "Página de planos e preços"],
  ["precos", "prefixo", "/precos", "Página de preços"],
  ["demo", "prefixo", "/demonstracao", "Pedido de demonstração"],
  ["contato", "prefixo", "/contato", "Página de contato"],
] as const;

/** Marcador de semeadura — ver o comentário em semear(). */
const CHAVE_SEMEADO = "lead_score_regras_site_semeadas";

async function semear() {
  const { rows } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [CHAVE_SEMEADO]
  );
  if (rows.length > 0) {
    console.log("[MIGRATE] Regras de site já semeadas — preservando a edição.");
    return;
  }

  for (const [tipo, condicao, pontos, descricao] of REGRAS_DE_SITE) {
    await client.query(
      `INSERT INTO lead_score_rules (event_type, condition, points, description)
       VALUES ($1, $2::jsonb, $3, $4)`,
      [tipo, condicao, pontos, descricao]
    );
  }
  for (const [evento, tipo, valor, descricao] of PAGINAS) {
    await client.query(
      `INSERT INTO site_event_rules (evento, match_type, valor, description)
       VALUES ($1, $2, $3, $4)`,
      [evento, tipo, valor, descricao]
    );
  }

  await client.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, 'true')
     ON CONFLICT (key) DO UPDATE SET value = 'true'`,
    [CHAVE_SEMEADO]
  );
  console.log(
    `[MIGRATE] ${REGRAS_DE_SITE.length} regras de pontuação e ${PAGINAS.length} páginas semeadas.`
  );
}

async function main() {
  await client.connect();

  // Tudo numa transação: derrubar o UNIQUE e criar o índice novo precisam
  // acontecer juntos ou não acontecer. No meio do caminho a tabela ficaria sem
  // proteção nenhuma contra regra duplicada.
  await client.query("BEGIN");

  console.log("[MIGRATE] lead_score_rules: condition + unicidade composta...");
  await client.query(
    `ALTER TABLE lead_score_rules ADD COLUMN IF NOT EXISTS condition jsonb`
  );

  // O coalesce é obrigatório: NULL não deduplica em índice único do Postgres,
  // então sem ele duas regras `site_visited` sem condição passariam.
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS lead_score_rules_regra_idx
       ON lead_score_rules (event_type, (coalesce(condition, '{}'::jsonb)))`
  );

  // O nome da constraint antiga é convenção do Postgres, não escolha nossa —
  // descobrir em pg_constraint em vez de chutar "lead_score_rules_event_type_key".
  const { rows: constraints } = await client.query(
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'lead_score_rules'::regclass AND contype = 'u'`
  );
  for (const { conname } of constraints) {
    if (conname === "lead_score_rules_regra_idx") continue;
    await client.query(
      `ALTER TABLE lead_score_rules DROP CONSTRAINT "${conname}"`
    );
    console.log(`[MIGRATE]   constraint antiga removida: ${conname}`);
  }

  console.log("[MIGRATE] site_event_rules...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS site_event_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      evento text NOT NULL,
      match_type text NOT NULL,
      valor text NOT NULL,
      description text,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS site_event_rules_alvo_idx
       ON site_event_rules (match_type, valor)`
  );

  // Deduplicação por sessão. O índice protege o caso ACIDENTAL — beacon
  // duplicado, retentativa, recarga da página — porque a sessão vem do
  // cliente. Contra quem varia a sessão de propósito, quem responde é o teto
  // por contato no endpoint.
  console.log("[MIGRATE] contact_events: dedup dos eventos de site...");
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS contact_events_site_sessao_idx
      ON contact_events (
        contact_id, type, (payload->>'sessao'), (coalesce(payload->>'evento',''))
      )
      WHERE type IN ('site_visited','site_event')
  `);

  await semear();

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
