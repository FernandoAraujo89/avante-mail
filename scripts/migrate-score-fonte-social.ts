import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: pontuação por REDE de origem (fase E.3 do
// docs/plano-webhooks-leads.md).
//
// Quatro regras novas, todas com `condition` sobre a chave `fonte` que a rota
// de coleta (/api/track/site) e o webhook de entrada passaram a gravar no
// payload — ver lib/leads/fonte.ts:
//
//   site_visited     {"fonte":"instagram"}   curinga + 3
//   site_visited     {"fonte":"facebook"}    curinga + 3
//   contact_created  {"fonte":"instagram"}   curinga + 5
//   contact_created  {"fonte":"facebook"}    curinga + 5
//
// O peso é um BÔNUS sobre o curinga do mesmo tipo, lido do banco na hora, e
// não um número fixo. O motivo é o que aconteceu em produção: o plano semeou
// "visitou o site" com 3, e o time subiu para 10 na tela. Uma regra fixa de 6
// venceria o curinga (a condição vence sempre) e a visita vinda do Instagram
// passaria a valer MENOS que uma visita qualquer — o contrário do que a regra
// existe para dizer. Com o plano intocado dá 6 e 15, os números do plano.
//
// Nenhuma mudança de esquema: `condition` e a unicidade composta
// (event_type + condition) vieram na fase E. Regra que já existe — inclusive
// uma que o time tenha editado ou desligado na tela — fica como está: a
// conferência é por (tipo, condição), nunca por peso.
//
// Se alguma regra entrou, zera `lead_score_at` dos leads. O recálculo barato
// do worker só olha quem tem evento NOVO, e uma regra nova muda a conta de
// quem já tinha o evento antigo. Zerar a marca é o que faz o worker repontuar
// todo mundo nos ciclos seguintes, sem esperar a passagem diária.
//
// O nome começa com "score-" de propósito: o deploy roda os migrate-*.ts em
// ordem alfabética, e este precisa vir DEPOIS de migrate-rastreio-site.ts,
// que cria a coluna `condition`. Rode uma vez:
// `npx tsx scripts/migrate-score-fonte-social.ts`

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

/**
 * Espelha as regras de fonte em REGRAS_PADRAO (lib/leads/score.ts): o bônus
 * sobre o curinga, e o curinga do plano para o caso de ele não existir.
 */
const REGRAS = [
  ["site_visited", '{"fonte":"instagram"}', 3, 3, "Visitou o site vindo do Instagram"],
  ["site_visited", '{"fonte":"facebook"}', 3, 3, "Visitou o site vindo do Facebook"],
  ["contact_created", '{"fonte":"instagram"}', 5, 10, "Entrou como lead pelo Instagram"],
  ["contact_created", '{"fonte":"facebook"}', 5, 10, "Entrou como lead pelo Facebook"],
] as const;

/** O peso do curinga do tipo, como está HOJE no banco (editado ou não). */
async function curinga(tipo: string, doPlano: number): Promise<number> {
  const { rows } = await client.query(
    `SELECT points FROM lead_score_rules
      WHERE event_type = $1 AND condition IS NULL AND active = true
      ORDER BY points DESC LIMIT 1`,
    [tipo]
  );
  return rows.length > 0 ? Number(rows[0].points) : doPlano;
}

async function main() {
  await client.connect();
  await client.query("BEGIN");

  let inseridas = 0;
  for (const [tipo, condicao, bonus, curingaDoPlano, descricao] of REGRAS) {
    // SELECT antes do INSERT, e não ON CONFLICT: assim a migração não depende
    // do nome nem da forma do índice único, e continua correta se ele mudar.
    const { rows } = await client.query(
      `SELECT 1 FROM lead_score_rules
        WHERE event_type = $1 AND condition = $2::jsonb`,
      [tipo, condicao]
    );
    if (rows.length > 0) continue;

    const base = await curinga(tipo, curingaDoPlano);
    const pontos = base + bonus;
    await client.query(
      `INSERT INTO lead_score_rules (event_type, condition, points, description)
       VALUES ($1, $2::jsonb, $3, $4)`,
      [tipo, condicao, pontos, descricao]
    );
    console.log(`[MIGRATE]   ${descricao}: ${pontos} pontos (curinga ${base} + ${bonus})`);
    inseridas++;
  }
  console.log(
    `[MIGRATE] Regras de fonte: ${inseridas} inseridas, ${REGRAS.length - inseridas} já existiam.`
  );

  if (inseridas > 0) {
    const r = await client.query(
      `UPDATE contacts SET lead_score_at = NULL WHERE stage IS NOT NULL`
    );
    console.log(`[MIGRATE] ${r.rowCount ?? 0} leads marcados para repontuação.`);
  }

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
