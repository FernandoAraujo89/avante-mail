import { randomBytes } from "crypto";
import { config } from "dotenv";
import { Client } from "pg";

// Cria (ou recria) uma origem de webhook — a fase A não tem tela ainda.
// O TOKEN CRU é mostrado UMA vez: o banco guarda só o hash.
//
// Uso:
//   npx tsx scripts/criar-origem-webhook.ts make-leads "Make — Leads do site"
//   npx tsx scripts/criar-origem-webhook.ts make-leads --remover

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[ORIGEM] DATABASE_URL não definida no .env.local.");
  process.exit(1);
}

const slug = process.argv[2];
const segundo = process.argv[3];
if (!slug) {
  console.error(
    "[ORIGEM] Uso: npx tsx scripts/criar-origem-webhook.ts <slug> [nome|--remover]"
  );
  process.exit(1);
}

const needsSsl = /sslmode=require|neon\.tech/.test(url);
const client = new Client({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

// Mapeamento inicial no formato que o Make costuma mandar. Ajuste depois pela
// coluna `mapping` — não exige deploy.
const MAPPING = {
  name: "nome",
  email: "email",
  phone: "telefone",
  company: "empresa",
  externalId: "id",
  tags: "tags",
  utmSource: "utm_source",
  utmMedium: "utm_medium",
  utmCampaign: "utm_campaign",
  utmContent: "utm_content",
  utmTerm: "utm_term",
  landingPage: "pagina",
  referrer: "referrer",
};

async function main() {
  await client.connect();

  if (segundo === "--remover") {
    const r = await client.query(`DELETE FROM webhook_sources WHERE slug = $1`, [
      slug,
    ]);
    console.log(`[ORIGEM] Removidas: ${r.rowCount}`);
    await client.end();
    process.exit(0);
  }

  // A lista de leads é o que separa lead de parceiro. Procurada pela MARCA
  // (kind), não pelo nome: renomear a lista na tela não pode desfazer a trava.
  // Cai no nome só para adotar a lista de antes da marca existir.
  const { rows: listas } = await client.query(
    `SELECT id FROM lists WHERE kind = 'leads' ORDER BY created_at LIMIT 1`
  );
  let listId = listas[0]?.id;
  if (!listId) {
    const { rows: porNome } = await client.query(
      `UPDATE lists SET kind = 'leads'
        WHERE id = (SELECT id FROM lists WHERE name ILIKE 'leads' LIMIT 1)
        RETURNING id`
    );
    listId = porNome[0]?.id;
    if (listId) console.log("[ORIGEM] Lista 'Leads' existente marcada.");
  }
  if (!listId) {
    const { rows } = await client.query(
      `INSERT INTO lists (name, description, kind)
       VALUES ('Leads', 'Leads recebidos por webhook — não recebem campanha sem marcar "Incluir leads"', 'leads')
       RETURNING id`
    );
    listId = rows[0].id;
    console.log("[ORIGEM] Lista 'Leads' criada.");
  }

  const token = randomBytes(32).toString("base64url");
  const { createHash } = await import("crypto");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const defaults = {
    tags: ["lead"],
    stage: "novo",
    listId,
    // Padrão do sistema: liberado. Vire false para bloquear uma origem
    // específica (lista comprada, formulário sem aviso de comunicação).
    consentimento: true,
  };

  await client.query(`DELETE FROM webhook_sources WHERE slug = $1`, [slug]);
  await client.query(
    `INSERT INTO webhook_sources (name, slug, token_hash, mapping, defaults)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      segundo || `Origem ${slug}`,
      slug,
      tokenHash,
      JSON.stringify(MAPPING),
      JSON.stringify(defaults),
    ]
  );

  const base =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ??
    "http://localhost:3000";

  console.log("\n[ORIGEM] Criada. Configure no Make (módulo HTTP):\n");
  console.log(`  URL     POST ${base}/api/webhooks/entrada/${slug}`);
  console.log(`  Header  Authorization: Bearer ${token}`);
  console.log(`  Body    application/json\n`);
  console.log("  Exemplo de corpo:");
  console.log(
    JSON.stringify(
      {
        nome: "Maria Silva",
        email: "maria@empresa.com.br",
        telefone: "31 99999-8888",
        empresa: "Empresa Exemplo",
        utm_source: "instagram",
        utm_medium: "social",
        utm_campaign: "lancamento-agosto",
        pagina: "https://avantejuntos.com.br/planos",
      },
      null,
      2
    )
      .split("\n")
      .map((l) => "  " + l)
      .join("\n")
  );
  console.log(
    "\n  ⚠️  O token aparece só agora — o banco guarda apenas o hash.\n"
  );

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[ORIGEM] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
