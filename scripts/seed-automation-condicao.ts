import { config } from "dotenv";
import { Client } from "pg";

// Automação de teste da FASE 3 — o Se/Então e a árvore de ramificação.
//
// Fluxo criado (gatilho: tag "teste-se" adicionada):
//
//   Se/Então: tem a tag "vip"?
//     ├── sim  → +rota-vip   → fim
//     └── não  → +rota-comum → fim
//
// Não envia nada de propósito: dá para exercitar os dois lados só mexendo nas
// tags do contato, sem gastar e-mail nem WhatsApp.
//
// Uso:
//   npx tsx scripts/seed-automation-condicao.ts            cria/ativa
//   npx tsx scripts/seed-automation-condicao.ts remover    apaga

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[SEED] DATABASE_URL não definida no .env.local.");
  process.exit(1);
}

const NOME = "Teste de ramificação (fase 3)";
const needsSsl = /sslmode=require|neon\.tech/.test(url);
const client = new Client({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

async function inserirPasso(args: {
  versionId: string;
  parentId: string | null;
  branch: "main" | "yes" | "no";
  position: number;
  type: string;
  config: unknown;
}): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO automation_steps (version_id, parent_id, branch, position, type, config)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      args.versionId,
      args.parentId,
      args.branch,
      args.position,
      args.type,
      JSON.stringify(args.config),
    ]
  );
  return rows[0].id;
}

async function main() {
  await client.connect();

  if (process.argv[2] === "remover") {
    const r = await client.query(`DELETE FROM automations WHERE name = $1`, [
      NOME,
    ]);
    console.log(`[SEED] Automação removida: ${r.rowCount}`);
    await client.end();
    process.exit(0);
  }

  await client.query(`DELETE FROM automations WHERE name = $1`, [NOME]);

  const { rows: auto } = await client.query(
    `INSERT INTO automations (name, description, status)
     VALUES ($1, 'Criada por scripts/seed-automation-condicao.ts', 'active')
     RETURNING id`,
    [NOME]
  );
  const automationId = auto[0].id;

  const { rows: versao } = await client.query(
    `INSERT INTO automation_versions (automation_id, version) VALUES ($1, 1)
     RETURNING id`,
    [automationId]
  );
  const versionId = versao[0].id;

  await client.query(
    `UPDATE automations SET current_version_id = $1 WHERE id = $2`,
    [versionId, automationId]
  );

  await client.query(
    `INSERT INTO automation_triggers (version_id, type, config)
     VALUES ($1, 'tag_added', $2)`,
    [versionId, JSON.stringify({ tag: "teste-se" })]
  );

  // Raiz: o Se/Então.
  const se = await inserirPasso({
    versionId,
    parentId: null,
    branch: "main",
    position: 0,
    type: "if_else",
    config: {
      match: "all",
      conditions: [{ type: "has_tag", tag: "vip" }],
    },
  });

  // Ramo "sim" e ramo "não": filhos do Se/Então, cada um com sua ordem.
  for (const [branch, tag] of [
    ["yes", "rota-vip"],
    ["no", "rota-comum"],
  ] as const) {
    await inserirPasso({
      versionId,
      parentId: se,
      branch,
      position: 0,
      type: "add_tag",
      config: { tag },
    });
    await inserirPasso({
      versionId,
      parentId: se,
      branch,
      position: 1,
      type: "end",
      config: {},
    });
  }

  console.log(`[SEED] Automação "${NOME}" ativa.`);
  console.log(`[SEED]   automation_id = ${automationId}`);
  console.log(`[SEED]   gatilho: tag "teste-se" adicionada`);
  console.log(`[SEED]   Se tem a tag "vip" → +rota-vip; senão → +rota-comum`);

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[SEED] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
