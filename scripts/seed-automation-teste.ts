import { config } from "dotenv";
import { Client } from "pg";

// Cria uma automação de teste — a fase 1 não tem tela ainda, então é assim que
// se prova o motor de ponta a ponta.
//
// Fluxo criado (gatilho: tag "vip" adicionada):
//   1. aguarda 1 minuto
//   2. adiciona a tag "vip-processado"
//   3. remove a tag "vip"
//   4. fim
//
// O passo 3 é proposital: ele desfaz o próprio gatilho, o que exercita a
// realimentação (a mudança de tag gera evento novo) sem entrar em laço —
// porque a reentrada é barrada pelo índice único.
//
// Uso:
//   npx tsx scripts/seed-automation-teste.ts            cria/ativa
//   npx tsx scripts/seed-automation-teste.ts remover    apaga

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[SEED] DATABASE_URL não definida no .env.local.");
  process.exit(1);
}

const NOME = "Teste do motor (fase 1)";
const needsSsl = /sslmode=require|neon\.tech/.test(url);
const client = new Client({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

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
     VALUES ($1, 'Criada por scripts/seed-automation-teste.ts', 'active')
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
    [versionId, JSON.stringify({ tag: "vip" })]
  );

  const passos: [string, unknown][] = [
    ["wait", { minutes: 1 }],
    ["add_tag", { tag: "vip-processado" }],
    ["remove_tag", { tag: "vip" }],
    ["end", {}],
  ];
  for (const [i, [tipo, cfg]] of passos.entries()) {
    await client.query(
      `INSERT INTO automation_steps (version_id, branch, position, type, config)
       VALUES ($1, 'main', $2, $3, $4)`,
      [versionId, i, tipo, JSON.stringify(cfg)]
    );
  }

  console.log(`[SEED] Automação "${NOME}" ativa.`);
  console.log(`[SEED]   automation_id = ${automationId}`);
  console.log(`[SEED]   gatilho: tag "vip" adicionada`);
  console.log(`[SEED]   passos: aguarda 1min → +vip-processado → -vip → fim`);

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[SEED] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
