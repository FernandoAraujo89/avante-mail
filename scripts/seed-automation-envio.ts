import { config } from "dotenv";
import { Client } from "pg";

// Automação de teste da FASE 2 — os passos de envio.
//
// Fluxo criado (gatilho: tag "boas-vindas" adicionada):
//   1. envia o e-mail de boas-vindas
//   2. envia o WhatsApp (só se houver modelo aprovado no banco)
//   3. aguarda 2 minutos
//   4. adiciona a tag "boas-vindas-enviado"
//   5. fim
//
// O conteúdo do e-mail vem do próprio passo (mjmlContent), que é a fonte da
// verdade — a alternativa é "templateId", resolvido no momento do envio.
// Enquanto a tela da fase 4 não existe, é assim que se monta um fluxo com
// envio.
//
// Uso:
//   npx tsx scripts/seed-automation-envio.ts            cria/ativa
//   npx tsx scripts/seed-automation-envio.ts remover    apaga

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[SEED] DATABASE_URL não definida no .env.local.");
  process.exit(1);
}

const NOME = "Teste de envio (fase 2)";
const needsSsl = /sslmode=require|neon\.tech/.test(url);
const client = new Client({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

const MJML = `<mjml>
  <mj-body background-color="#f4f4f5">
    <mj-section background-color="#ffffff" padding="32px">
      <mj-column>
        <mj-text font-size="20px" font-weight="700">Olá, {{nome_parceiro}}!</mj-text>
        <mj-text>Este e-mail saiu de um passo de automação — mesma máquina de envio das campanhas.</mj-text>
        <mj-text font-size="12px" color="#71717a">
          <a href="{{unsubscribe_url}}">Cancelar inscrição</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

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
     VALUES ($1, 'Criada por scripts/seed-automation-envio.ts', 'active')
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
    [versionId, JSON.stringify({ tag: "boas-vindas" })]
  );

  const passos: [string, unknown][] = [
    [
      "send_email",
      {
        subject: "Bem-vindo à Avante",
        preheader: "Enviado por uma automação",
        mjmlContent: MJML,
      },
    ],
  ];

  // O passo de WhatsApp só entra se houver modelo aprovado — sem isso o motor
  // falharia o percurso de propósito, e o teste do e-mail iria junto.
  const { rows: modelos } = await client.query(
    `SELECT id, name FROM whatsapp_templates WHERE status = 'approved' LIMIT 1`
  );
  if (modelos.length > 0) {
    passos.push([
      "send_whatsapp",
      {
        whatsappTemplateId: modelos[0].id,
        variables: { "1": { source: "name" } },
      },
    ]);
  }

  passos.push(
    ["wait", { minutes: 2 }],
    ["add_tag", { tag: "boas-vindas-enviado" }],
    ["end", {}]
  );

  for (const [i, [tipo, cfg]] of passos.entries()) {
    await client.query(
      `INSERT INTO automation_steps (version_id, branch, position, type, config)
       VALUES ($1, 'main', $2, $3, $4)`,
      [versionId, i, tipo, JSON.stringify(cfg)]
    );
  }

  console.log(`[SEED] Automação "${NOME}" ativa.`);
  console.log(`[SEED]   automation_id = ${automationId}`);
  console.log(`[SEED]   gatilho: tag "boas-vindas" adicionada`);
  console.log(
    `[SEED]   passos: ${passos.map(([t]) => t).join(" → ")}` +
      (modelos.length > 0
        ? ` (WhatsApp pelo modelo "${modelos[0].name}")`
        : " (sem modelo de WhatsApp aprovado — passo omitido)")
  );
  console.log(
    `[SEED] ATENÇÃO: com o worker de e-mail no ar, marcar um contato com a tag "boas-vindas" ENVIA de verdade.`
  );

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[SEED] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
