import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: as travas contra disparo acidental (fase B do
// docs/plano-webhooks-leads.md, seção 5).
//  - lists.kind: marca QUAL lista é a de leads. O nome "Leads" pode ser
//    renomeado na tela; a marca é o que o código consulta.
//  - campaigns.include_leads: a campanha precisa dizer, explicitamente, que
//    quer mandar para lead. O padrão false vale também para as campanhas que
//    já existem — nenhuma delas foi criada com leads em mente.
// Rode uma vez: `npx tsx scripts/migrate-leads-travas.ts`

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

async function main() {
  await client.connect();

  console.log("[MIGRATE] lists.kind...");
  await client.query(`ALTER TABLE lists ADD COLUMN IF NOT EXISTS kind text`);
  await client.query(
    `CREATE INDEX IF NOT EXISTS lists_kind_idx ON lists (kind)
       WHERE kind IS NOT NULL`
  );

  console.log("[MIGRATE] campaigns.include_leads...");
  await client.query(
    `ALTER TABLE campaigns
       ADD COLUMN IF NOT EXISTS include_leads boolean NOT NULL DEFAULT false`
  );

  // A lista de leads já existe se alguma origem de webhook foi cadastrada
  // (scripts/criar-origem-webhook.ts a cria). Aqui ela só ganha a marca.
  const { rows: marcadas } = await client.query(
    `SELECT id, name FROM lists WHERE kind = 'leads'`
  );
  if (marcadas.length > 0) {
    console.log(
      `[MIGRATE] Lista de leads já marcada: ${marcadas
        .map((l) => l.name)
        .join(", ")}`
    );
  } else {
    const { rows } = await client.query(
      `UPDATE lists SET kind = 'leads' WHERE name ILIKE 'leads' RETURNING id, name`
    );
    if (rows.length > 0) {
      console.log(`[MIGRATE] Lista "${rows[0].name}" marcada como de leads.`);
    } else {
      // Sem lista nenhuma, a trava não teria onde se ancorar: a entrada por
      // webhook cairia sem destino e o seletor não teria o que excluir.
      const { rows: criada } = await client.query(
        `INSERT INTO lists (name, description, kind)
         VALUES ('Leads', 'Leads recebidos por webhook — não recebem campanha sem marcar "Incluir leads"', 'leads')
         RETURNING id, name`
      );
      console.log(`[MIGRATE] Lista "${criada[0].name}" criada e marcada.`);
    }
  }

  // Quem entrou por webhook antes da fase B pode estar sem estágio se a origem
  // mandou defaults sem `stage`. Sem estágio, a trava não o reconhece como
  // lead — e ele voltaria a entrar em campanha de parceiro.
  const { rowCount: semEstagio } = await client.query(
    `UPDATE contacts SET stage = 'novo'
      WHERE stage IS NULL
        AND id IN (
          SELECT cl.contact_id FROM contact_lists cl
          JOIN lists l ON l.id = cl.list_id AND l.kind = 'leads'
        )
        AND acquired_at IS NOT NULL`
  );
  console.log(`[MIGRATE] Leads sem estágio corrigidos: ${semEstagio ?? 0}`);

  console.log("[MIGRATE] Concluído.");

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
