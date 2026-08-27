import { config } from "dotenv";
import { Client } from "pg";

// Sincronização com o Pipedrive (reconciliação) — o que a tabela precisa:
//
//   lead_stages.aliases          os nomes das etapas do funil no Pipedrive que
//                                traduzem para cada marco daqui (N → 1);
//   lead_stages.convert_list_id  chegar na etapa CONVERTE o lead em parceiro
//                                para esta lista (nulo = conversão manual).
//
// A semente dos apelidos espelha o funil "White Label - Inbound" (lido do
// Pipedrive em 27/08/2026): as 6 primeiras etapas de lá são "ainda em
// qualificação"; das apresentações em diante é "passou por apresentação".
// "Comprou" não tem apelido — vem do STATUS ganho do deal, não de etapa.
//
// A lista de conversão do "comprou" é semeada com a "Parceiros WHITE LABEL"
// SE ela existir (produção) — é o comportamento pedido: comprou, sai da
// nutrição e vira parceiro. Em qualquer banco sem essa lista, fica manual.
//
// Rode uma vez: `npx tsx scripts/migrate-pipedrive-sync.ts`

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

const MARCADOR = "pipedrive_sync";

const APELIDOS: [string, string[]][] = [
  [
    "qualificado",
    [
      "Pesquisa",
      "Realizar contato",
      "Qualificar lead",
      "Em análise/Agendar apresentação",
      "Agendar apresentação parte técnica",
    ],
  ],
  [
    "apresentacao-de-produto",
    [
      "Apresentar parte técnica",
      "Apresentar proposta comercial",
      "Analisando proposta",
      "Aguardar assinatura e pagamento",
    ],
  ],
];

const LISTA_DE_CONVERSAO = "Parceiros WHITE LABEL";

async function main() {
  await client.connect();

  const { rows: feito } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [MARCADOR]
  );
  if (feito.length > 0) {
    console.log("[MIGRATE] Sincronização do Pipedrive já migrada.");
    await client.end();
    process.exit(0);
  }

  await client.query("BEGIN");

  console.log("[MIGRATE] lead_stages: aliases e conversão automática...");
  await client.query(
    `ALTER TABLE lead_stages
       ADD COLUMN IF NOT EXISTS aliases text[],
       ADD COLUMN IF NOT EXISTS convert_list_id uuid REFERENCES lists(id) ON DELETE SET NULL`
  );

  for (const [slug, apelidos] of APELIDOS) {
    const { rowCount } = await client.query(
      `UPDATE lead_stages SET aliases = $2, updated_at = now()
        WHERE slug = $1 AND (aliases IS NULL OR aliases = '{}')`,
      [slug, apelidos]
    );
    console.log(
      `[MIGRATE]   ${slug}: ${rowCount ? `${apelidos.length} apelidos` : "mantido como estava"}`
    );
  }

  const { rows: listas } = await client.query(
    `SELECT id FROM lists WHERE name = $1 AND (kind IS NULL OR kind <> 'leads') LIMIT 1`,
    [LISTA_DE_CONVERSAO]
  );
  if (listas.length > 0) {
    const { rowCount } = await client.query(
      `UPDATE lead_stages SET convert_list_id = $1, updated_at = now()
        WHERE slug = 'comprou' AND convert_list_id IS NULL`,
      [listas[0].id]
    );
    console.log(
      `[MIGRATE]   comprou → converte para "${LISTA_DE_CONVERSAO}": ${rowCount ? "ligado" : "já configurado"}`
    );
  } else {
    console.log(
      `[MIGRATE]   lista "${LISTA_DE_CONVERSAO}" não existe neste banco — conversão do "comprou" segue manual (configure em /leads/etapas).`
    );
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
