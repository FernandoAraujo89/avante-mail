import { config } from "dotenv";
import { Client } from "pg";

import { fonteDoReferrer } from "../lib/leads/fonte";

// Migração idempotente: estampa a `fonte` nas visitas de ANTES da fase E.3
// (fase 1.5 do docs/plano-webhooks-leads.md).
//
// A rota de coleta grava `fonte` desde 04/09/2026. As visitas anteriores só
// têm o host do referrer — e a fonte é derivação pura dele (`l.instagram.com`
// → instagram, `www.google.com` → google), então dá para preencher o que a
// rota teria gravado se já existisse. É o que faz a regra "visitou o site
// vindo do Instagram" valer para o histórico, que é o espírito do score
// derivado: mudar o modelo vale para trás, não só dali em diante.
//
// Toca nas DUAS tabelas de eventos de site: a do contato (contact_events) e a
// anônima (anonymous_site_events), que ainda vai ser costurada — sem ela, um
// visitante de ontem que virar lead amanhã entraria sem fonte. Os eventos
// nomeados (site_event) recebem a fonte da visita da MESMA sessão, como a
// rota faz hoje.
//
// Só linhas SEM fonte são tocadas, então rodar de novo não faz nada: não
// precisa de marcador. Referrer nosso ou desconhecido (linktr.ee) não vira
// fonte — o normalizador devolve nulo e a linha fica como está.
//
// Leads com visita estampada têm `lead_score_at` zerado: o recálculo barato
// só olha evento NOVO, e aqui o evento é velho com conta nova.
//
// O nome começa com "score-" para vir depois de migrate-rastreio-anonimo.ts
// na ordem alfabética do deploy; mesmo assim confere se as tabelas existem,
// porque um banco novo não deve quebrar o deploy por causa de um backfill.
// Rode uma vez: `npx tsx scripts/migrate-score-fonte-visitas.ts`

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

async function tabelaExiste(nome: string): Promise<boolean> {
  const { rows } = await client.query(`SELECT to_regclass($1) AS r`, [nome]);
  return rows[0]?.r !== null;
}

/**
 * Estampa as visitas de uma tabela e devolve os donos tocados (contact_id ou
 * visitor_id, conforme a coluna).
 */
async function estamparVisitas(tabela: string, colunaDono: string): Promise<Set<string>> {
  const { rows: hosts } = await client.query(
    `SELECT DISTINCT payload->>'refHost' AS host FROM ${tabela}
      WHERE type = 'site_visited' AND payload ? 'refHost' AND NOT (payload ? 'fonte')`
  );
  const donos = new Set<string>();
  let visitas = 0;
  for (const { host } of hosts) {
    const fonte = fonteDoReferrer(host);
    if (!fonte) continue;
    const r = await client.query(
      `UPDATE ${tabela}
          SET payload = payload || jsonb_build_object('fonte', $2::text)
        WHERE type = 'site_visited' AND payload->>'refHost' = $1
          AND NOT (payload ? 'fonte')
        RETURNING ${colunaDono} AS dono`,
      [host, fonte]
    );
    visitas += r.rowCount ?? 0;
    for (const linha of r.rows) donos.add(String(linha.dono));
    console.log(`[MIGRATE]   ${tabela}: ${host} → ${fonte} (${r.rowCount})`);
  }

  // O evento nomeado herda a fonte da visita da mesma sessão e do mesmo dono.
  const eventos = await client.query(
    `UPDATE ${tabela} e
        SET payload = e.payload || jsonb_build_object('fonte', v.payload->>'fonte')
       FROM ${tabela} v
      WHERE e.type = 'site_event' AND NOT (e.payload ? 'fonte')
        AND v.type = 'site_visited' AND v.payload ? 'fonte'
        AND v.${colunaDono} = e.${colunaDono}
        AND v.payload->>'sessao' = e.payload->>'sessao'
      RETURNING e.${colunaDono} AS dono`
  );
  for (const linha of eventos.rows) donos.add(String(linha.dono));
  console.log(
    `[MIGRATE] ${tabela}: ${visitas} visita(s) e ${eventos.rowCount ?? 0} evento(s) estampados.`
  );
  return donos;
}

async function main() {
  await client.connect();
  await client.query("BEGIN");

  if (await tabelaExiste("contact_events")) {
    const contatos = await estamparVisitas("contact_events", "contact_id");
    if (contatos.size > 0) {
      const r = await client.query(
        `UPDATE contacts SET lead_score_at = NULL WHERE id = ANY($1::uuid[])`,
        [[...contatos]]
      );
      console.log(`[MIGRATE] ${r.rowCount ?? 0} lead(s) marcados para repontuação.`);
    }
  } else {
    console.log("[MIGRATE] contact_events ainda não existe — nada a estampar.");
  }

  if (await tabelaExiste("anonymous_site_events")) {
    await estamparVisitas("anonymous_site_events", "visitor_id");
  } else {
    console.log("[MIGRATE] anonymous_site_events ainda não existe — nada a estampar.");
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
