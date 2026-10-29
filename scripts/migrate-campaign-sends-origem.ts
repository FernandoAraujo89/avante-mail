import { config } from "dotenv";
import { Client } from "pg";

import { recriarRestricaoDeOrigem } from "../lib/db/origem-de-envio";

// Migração idempotente: corrige a restrição de origem de campaign_sends.
//
// A restrição criada na fase 2 exigia campanha OU percurso. Só que a chave
// estrangeira do percurso é ON DELETE SET NULL — de propósito, para o histórico
// de envio (e o custo já pago) sobreviver à remoção da automação. As duas
// regras se contradiziam: apagar uma automação que já tinha enviado zerava o
// automation_run_id e a linha passava a violar a própria restrição, então o
// DELETE falhava com erro de constraint.
//
// A restrição agora aceita também o passo (automation_step_id, que não tem FK e
// permanece na linha). Continua barrando o que ela existia para barrar: envio
// gravado sem origem nenhuma — cobrado e invisível em qualquer relatório.
//
// 29/10/2026: a definição passou a vir de lib/db/origem-de-envio.ts, com as
// colunas que existem no momento (inclusive survey_invite_id, da pesquisa).
// Este script recriava a restrição sem a pesquisa a cada deploy e, no primeiro
// deploy depois dos primeiros convites reais, falhou e deixou a tabela sem
// restrição. O DROP e o ADD agora vão num ALTER só, atômico.
//
// Rode uma vez: `npx tsx scripts/migrate-campaign-sends-origem.ts`

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

  console.log("[MIGRATE] campaign_sends: restrição de origem...");
  const expressao = await recriarRestricaoDeOrigem(client);
  console.log(`[MIGRATE]   CHECK (${expressao})`);

  console.log("[MIGRATE] Concluído.");

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
