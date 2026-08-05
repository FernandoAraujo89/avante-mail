import { config } from "dotenv";
import { Client } from "pg";

// O lead ganha DUAS informações que vêm do agente por webhook:
//
//   QUALIFICAÇÃO — quem ele é, pelo playbook do SDR (Experiente,
//   Intermediário, Iniciante, Alto Potencial). Vocabulário nosso; mora no
//   código (`components/leads/qualificacoes.ts`).
//
//   ETAPA — onde ele está no funil do PIPEDRIVE. O agente acompanha o funil lá
//   e nos avisa quando o lead anda. Vocabulário do comercial; mora em tabela
//   (`lead_stages`), porque o funil muda quando eles quiserem e uma constante
//   no código exigiria deploy nosso a cada mudança de processo alheio.
//
// Os estágios antigos (novo/contatado/qualificado/…) descreviam um funil de
// vendas que este sistema nunca teve como preencher. Viram a etapa de entrada.
//
// Rode uma vez: `npx tsx scripts/migrate-etapas-e-qualificacao.ts`

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

const MARCADOR = "lead_etapas_e_qualificacao";

const ETAPA_DE_ENTRADA = "qualificado";

// SÓ as etapas que o usuário nomeou, mais a de entrada. O resto do funil do
// Pipedrive se cadastra em /leads/etapas: inventar as etapas dos outros é
// exatamente como a tela passa a mentir — já aconteceu com as páginas do site
// no rastreio, e o custo foi retrabalho.
const ETAPAS: [string, string, number, boolean][] = [
  [ETAPA_DE_ENTRADA, "Qualificado pelo agente", 10, false],
  ["apresentacao-de-produto", "Passou por apresentação de produto", 20, false],
  ["comprou", "Comprou", 90, true],
];

// Quem chega mais maduro começa mais quente. Os pontos são editáveis em
// /leads/pontuacao como qualquer outra regra — a semente é só o ponto de
// partida, e o time vai querer mexer depois de ver o score rodando.
const REGRAS: [string, string, number, string][] = [
  [
    "lead_qualified",
    '{"qualificacao":"experiente"}',
    30,
    "Qualificado como Experiente (alto potencial)",
  ],
  [
    "lead_qualified",
    '{"qualificacao":"alto_potencial"}',
    25,
    "Qualificado como Alto Potencial",
  ],
  [
    "lead_qualified",
    '{"qualificacao":"intermediario"}',
    15,
    "Qualificado como Intermediário",
  ],
  [
    "lead_qualified",
    '{"qualificacao":"iniciante"}',
    8,
    "Qualificado como Iniciante",
  ],
];

async function main() {
  await client.connect();

  const { rows: feito } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [MARCADOR]
  );
  if (feito.length > 0) {
    console.log("[MIGRATE] Etapas e qualificação já migradas.");
    await client.end();
    process.exit(0);
  }

  await client.query("BEGIN");

  console.log("[MIGRATE] lead_stages...");
  await client.query(
    `CREATE TABLE IF NOT EXISTS lead_stages (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       slug text NOT NULL UNIQUE,
       label text NOT NULL,
       position integer NOT NULL DEFAULT 0,
       stops_nurturing boolean NOT NULL DEFAULT false,
       active boolean NOT NULL DEFAULT true,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  for (const [slug, label, position, para] of ETAPAS) {
    await client.query(
      `INSERT INTO lead_stages (slug, label, position, stops_nurturing)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO NOTHING`,
      [slug, label, position, para]
    );
  }
  console.log(`[MIGRATE]   ${ETAPAS.length} etapas semeadas`);

  console.log("[MIGRATE] contacts: qualificação e data da etapa...");
  await client.query(
    `ALTER TABLE contacts
       ADD COLUMN IF NOT EXISTS qualification text,
       ADD COLUMN IF NOT EXISTS qualified_at timestamptz,
       ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz`
  );
  // A ponte com o comercial foi abandonada antes de existir em produção; a
  // coluna só existe em bancos de desenvolvimento.
  await client.query(
    `ALTER TABLE contacts DROP COLUMN IF EXISTS enviado_ao_comercial_em`
  );

  // Todo lead vira a etapa de entrada: nenhum estágio antigo tem equivalente no
  // funil do Pipedrive, e adivinhar em qual etapa cada um está seria inventar
  // um fato sobre a venda de outra pessoa. O agente corrige na primeira
  // atualização que mandar.
  const { rowCount: leads } = await client.query(
    `UPDATE contacts SET stage = $1 WHERE stage IS NOT NULL AND stage <> $1`,
    [ETAPA_DE_ENTRADA]
  );
  console.log(`[MIGRATE] Leads na etapa de entrada: ${leads ?? 0}`);

  // As origens de webhook carregam a etapa de entrada nos seus defaults; sem
  // isto, todo lead novo entraria com uma etapa que não existe mais.
  const { rowCount: origens } = await client.query(
    `UPDATE webhook_sources
        SET defaults = jsonb_set(coalesce(defaults, '{}'::jsonb), '{stage}', $1::jsonb)
      WHERE coalesce(defaults->>'stage', '') <> $2`,
    [JSON.stringify(ETAPA_DE_ENTRADA), ETAPA_DE_ENTRADA]
  );
  console.log(`[MIGRATE] Origens de webhook ajustadas: ${origens ?? 0}`);

  console.log("[MIGRATE] lead_score_rules: pontos por qualificação...");
  const { rows: jaTem } = await client.query(
    `SELECT 1 FROM lead_score_rules WHERE event_type = 'lead_qualified' LIMIT 1`
  );
  if (jaTem.length > 0) {
    console.log("[MIGRATE]   já semeadas — preservando a edição.");
  } else {
    for (const [tipo, condicao, pontos, descricao] of REGRAS) {
      await client.query(
        `INSERT INTO lead_score_rules (event_type, condition, points, description)
         VALUES ($1, $2::jsonb, $3, $4)`,
        [tipo, condicao, pontos, descricao]
      );
    }
    console.log(`[MIGRATE]   ${REGRAS.length} regras semeadas`);
  }

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
