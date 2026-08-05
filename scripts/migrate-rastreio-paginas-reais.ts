import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: corrige as páginas de intenção do rastreio de site.
//
// POR QUE ELA EXISTE: a migração da fase E semeou `/planos`, `/precos`,
// `/demonstracao` e `/contato` como ponto de partida. Nenhuma das quatro
// existe em avantejuntos.com.br — as três primeiras respondem 404 e `/contato`
// é um 301 para `/fale-conosco`, então o visitante nunca fica nela. Eram
// regras que jamais disparariam, dando a impressão de pontuação configurada.
//
// Substitui pelas páginas reais, verificadas no sitemap do site (todas 200).
//
// NÃO CLOBBERA EDIÇÃO: cada remoção confere se a linha ainda está exatamente
// como foi semeada. Se alguém já mexeu naquela regra na tela, ela fica.
//
// Rode uma vez: `npx tsx scripts/migrate-rastreio-paginas-reais.ts`

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

/** O que a fase E semeou e não serve para este site. */
const INVENTADAS = [
  ["precos", "prefixo", "/planos"],
  ["precos", "prefixo", "/precos"],
  ["demo", "prefixo", "/demonstracao"],
  ["contato", "prefixo", "/contato"],
] as const;

/**
 * As páginas REAIS, do sitemap de avantejuntos.com.br.
 *
 * Dois níveis de intenção, e os nomes descrevem o que a página é neste site —
 * "preços" e "demonstração" não descreviam nada, porque não existem aqui.
 *
 *  contato (+25): a pessoa está pedindo conversa ou se cadastrando;
 *  produto (+10): a pessoa está pesquisando o que a Avante vende.
 */
const PAGINAS = [
  ["contato", "prefixo", "/fale-conosco", "Fale Conosco"],
  ["contato", "prefixo", "/interesse-parceiro", "Interesse — Parceiro"],
  ["contato", "prefixo", "/edit-interesse-parceiro", "Interesse por produto"],
  ["contato", "prefixo", "/formulario-web", "Formulário WEB"],
  ["contato", "prefixo", "/sign-up", "Cadastro"],
  ["produto", "prefixo", "/produtos", "Páginas de produto"],
  ["produto", "prefixo", "/avante-produtos", "Produtos Avante"],
  ["produto", "prefixo", "/adicionais", "Módulos adicionais"],
  ["produto", "prefixo", "/white-label", "White label"],
] as const;

const CHAVE = "rastreio_paginas_reais_aplicado";

async function main() {
  await client.connect();

  const { rows: jaFeito } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [CHAVE]
  );
  if (jaFeito.length > 0) {
    console.log("[MIGRATE] Páginas reais já aplicadas — preservando a edição.");
    await client.end();
    process.exit(0);
  }

  await client.query("BEGIN");

  // 1. Remove as inventadas, só se intactas.
  let removidas = 0;
  for (const [evento, tipo, valor] of INVENTADAS) {
    const r = await client.query(
      `DELETE FROM site_event_rules
        WHERE evento = $1 AND match_type = $2 AND valor = $3 AND active = true`,
      [evento, tipo, valor]
    );
    removidas += r.rowCount ?? 0;
  }
  console.log(`[MIGRATE] Regras inventadas removidas: ${removidas}`);

  // 2. Renomeia os eventos da pontuação para o que este site tem.
  //    Só se ainda estiverem com o peso semeado — peso mexido = decisão de
  //    alguém, e trocar por baixo seria desfazer escolha do time.
  const precos = await client.query(
    `UPDATE lead_score_rules
        SET condition = '{"evento":"produto"}'::jsonb,
            description = 'Pesquisou produto no site'
      WHERE event_type = 'site_event'
        AND condition = '{"evento":"precos"}'::jsonb
        AND points = 10`
  );
  const demo = await client.query(
    `UPDATE lead_score_rules
        SET condition = '{"evento":"contato"}'::jsonb,
            description = 'Pediu contato no site',
            points = 25
      WHERE event_type = 'site_event'
        AND condition = '{"evento":"demo"}'::jsonb
        AND points = 25`
  );
  console.log(
    `[MIGRATE] Regras de pontuação renomeadas: ${(precos.rowCount ?? 0) + (demo.rowCount ?? 0)}`
  );

  // 3. Insere as reais. ON CONFLICT porque o índice único é (match_type, valor)
  //    e a migração pode rodar num banco onde alguém já cadastrou a mesma.
  let inseridas = 0;
  for (const [evento, tipo, valor, descricao] of PAGINAS) {
    const r = await client.query(
      `INSERT INTO site_event_rules (evento, match_type, valor, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (match_type, valor) DO NOTHING`,
      [evento, tipo, valor, descricao]
    );
    inseridas += r.rowCount ?? 0;
  }
  console.log(`[MIGRATE] Páginas reais cadastradas: ${inseridas}`);

  await client.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, 'true')
     ON CONFLICT (key) DO UPDATE SET value = 'true'`,
    [CHAVE]
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
