import { config } from "dotenv";
import { Client } from "pg";

// O funil INTEIRO do Pipedrive, etapa por etapa, com pontos — e acompanhando
// dois funis em vez de um (14/09/2026).
//
// Até aqui o sistema tinha três marcos (Qualificado no CRM → Passou por
// apresentação de produto → Comprou) e traduzia as 8 etapas do Pipedrive neles
// pelos apelidos. O pedido agora é o funil como o comercial o enxerga, com uma
// pontuação coerente, e seguindo também o "SDR-TESTE-NRG" — que tem as mesmas
// etapas do "White Label - Inbound" (só a 4ª muda de nome).
//
//   1. As 8 etapas entram com o nome do Pipedrive, lidas em 14/09/2026 dos
//      funis 8 ("White Label - Inbound") e 14 ("SDR-TESTE-NRG"). O nome da 4ª
//      no funil do SDR vira apelido.
//   2. A etapa de entrada perde os apelidos, e o nome "Qualificado no CRM"
//      vira "Lead captado": na frente de "Pesquisa" e de "Qualificar lead", ele
//      diria o contrário do que é — quem está ali só chegou. O slug
//      `qualificado` fica: é ele que os leads, as origens e os gatilhos levam.
//      Nome editado à mão pela tela é preservado.
//   3. O marco "Passou por apresentação de produto" é desativado e perde os
//      apelidos: as etapas de verdade tomam o lugar dele. A posição 61, logo
//      depois de "Apresentar parte técnica" (a primeira etapa que ele cobria),
//      faz quem passou por ele no histórico continuar contando até ali no
//      funil acumulado do relatório. Gatilho de automação que esperava por ele
//      passa a esperar "Apresentar parte técnica".
//   4. Pontos por etapa: regras `lead_stage_changed` por `para`. Valem só para
//      a etapa ATUAL (lib/leads/score.ts), então cada número é o valor de
//      ESTAR ali — não um incremento. Pesquisa e Realizar contato não pontuam:
//      são a fila do vendedor, o lead ainda não fez nada. Do "Qualificar lead"
//      em diante o salto cresce perto do fechamento: a proposta já deixa o lead
//      aquecido sozinha, e quem aguarda assinatura já é quente. "Comprou" fica
//      sem pontos: quem compra vira parceiro e sai da pontuação.
//   5. Os funis acompanhados vão para app_settings, por id (renomear o funil
//      no Pipedrive não pode parar a sincronização).
//   6. As marcas-d'água da sincronização são apagadas: a próxima passada relê
//      os dois funis e põe cada lead na etapa exata — hoje eles estão nos
//      marcos.
//
// Rode uma vez: `npx tsx scripts/migrate-sincroniza-funil-completo.ts`

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

const MARCADOR = "funil_completo_pipedrive";

const ETAPA_DE_ENTRADA = "qualificado";
const MARCO_ANTIGO = "apresentacao-de-produto";

/** Funis do Pipedrive acompanhados: 8 = White Label - Inbound, 14 = SDR-TESTE-NRG. */
const FUNIS = [8, 14];

interface Etapa {
  slug: string;
  label: string;
  position: number;
  pontos: number;
  aliases: string[];
}

const ETAPAS: Etapa[] = [
  { slug: "pesquisa", label: "Pesquisa", position: 20, pontos: 0, aliases: [] },
  {
    slug: "realizar-contato",
    label: "Realizar contato",
    position: 30,
    pontos: 0,
    aliases: [],
  },
  {
    slug: "qualificar-lead",
    label: "Qualificar lead",
    position: 40,
    pontos: 10,
    aliases: [],
  },
  {
    slug: "agendar-apresentacao-parte-tecnica",
    label: "Agendar apresentação parte técnica",
    position: 50,
    pontos: 20,
    aliases: ["Em análise/Agendar apresentação"],
  },
  {
    slug: "apresentar-parte-tecnica",
    label: "Apresentar parte técnica",
    position: 60,
    pontos: 30,
    aliases: [],
  },
  {
    slug: "apresentar-proposta-comercial",
    label: "Apresentar proposta comercial",
    position: 70,
    pontos: 50,
    aliases: [],
  },
  {
    slug: "analisando-proposta",
    label: "Analisando proposta",
    position: 80,
    pontos: 70,
    aliases: [],
  },
  {
    slug: "aguardar-assinatura-e-pagamento",
    label: "Aguardar assinatura e pagamento",
    position: 90,
    pontos: 100,
    aliases: [],
  },
];

/** A mesma normalização de `slugDaEtapa` (components/leads/estagios.ts). */
function slug(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  await client.connect();

  const { rows: feito } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [MARCADOR]
  );
  if (feito.length > 0) {
    console.log("[MIGRATE] Funil completo do Pipedrive já migrado.");
    await client.end();
    process.exit(0);
  }

  await client.query("BEGIN");

  console.log("[MIGRATE] lead_stages: as 8 etapas do Pipedrive...");
  for (const e of ETAPAS) {
    const { rowCount } = await client.query(
      `INSERT INTO lead_stages (slug, label, position, aliases)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO NOTHING`,
      [e.slug, e.label, e.position, e.aliases]
    );
    console.log(
      `[MIGRATE]   ${e.label}: ${rowCount ? "criada" : "já existia — mantida como estava"}`
    );
  }

  // Um apelido velho que agora é o nome (ou o apelido) de uma etapa nova
  // precisa sair: `casarEtapa` procura nos apelidos na ordem do funil, e o
  // "Em análise/Agendar apresentação" que a etapa de entrada carregava
  // venceria o da etapa certa. Apelido que não colide fica.
  const tomados = new Set(
    ETAPAS.flatMap((e) => [e.slug, ...e.aliases.map(slug)])
  );
  const { rows: antigas } = await client.query<{
    slug: string;
    aliases: string[] | null;
  }>(`SELECT slug, aliases FROM lead_stages WHERE slug = ANY($1)`, [
    [ETAPA_DE_ENTRADA, MARCO_ANTIGO],
  ]);
  for (const antiga of antigas) {
    const restantes = (antiga.aliases ?? []).filter((a) => !tomados.has(slug(a)));
    await client.query(
      `UPDATE lead_stages SET aliases = $2, updated_at = now() WHERE slug = $1`,
      [antiga.slug, restantes]
    );
    console.log(
      `[MIGRATE]   ${antiga.slug}: ${(antiga.aliases ?? []).length - restantes.length} apelido(s) passaram para as etapas novas`
    );
  }

  const { rowCount: renomeada } = await client.query(
    `UPDATE lead_stages SET label = 'Lead captado', updated_at = now()
      WHERE slug = $1 AND label = 'Qualificado no CRM'`,
    [ETAPA_DE_ENTRADA]
  );
  console.log(
    `[MIGRATE]   entrada "Qualificado no CRM" → "Lead captado": ${renomeada ? "renomeada" : "já tinha outro nome — mantido"}`
  );
  // O nome antigo fica como apelido: uma integração que ainda mande "Qualificado
  // no CRM" continua casando, em vez de ser recusada em silêncio.
  await client.query(
    `UPDATE lead_stages
        SET aliases = array_append(coalesce(aliases, '{}'), 'Qualificado no CRM')
      WHERE slug = $1
        AND label <> 'Qualificado no CRM'
        AND NOT ('Qualificado no CRM' = ANY(coalesce(aliases, '{}')))`,
    [ETAPA_DE_ENTRADA]
  );

  const { rowCount: marco } = await client.query(
    `UPDATE lead_stages SET active = false, position = 61, updated_at = now()
      WHERE slug = $1`,
    [MARCO_ANTIGO]
  );
  console.log(
    `[MIGRATE]   marco "${MARCO_ANTIGO}": ${marco ? "desativado" : "não existe neste banco"}`
  );

  const { rowCount: compra } = await client.query(
    `UPDATE lead_stages SET position = 100, updated_at = now()
      WHERE slug = 'comprou' AND position = 90`
  );
  console.log(
    `[MIGRATE]   comprou: ${compra ? "vai para o fim do funil (posição 100)" : "posição mantida"}`
  );

  console.log("[MIGRATE] automation_triggers: gatilhos do marco antigo...");
  const { rowCount: gatilhos } = await client.query(
    `UPDATE automation_triggers
        SET config = jsonb_set(config, '{para}', '"apresentar-parte-tecnica"')
      WHERE type = 'lead_stage_changed' AND config->>'para' = $1`,
    [MARCO_ANTIGO]
  );
  console.log(
    `[MIGRATE]   ${gatilhos ?? 0} gatilho(s) passam a esperar "Apresentar parte técnica"`
  );

  console.log("[MIGRATE] lead_score_rules: pontos por etapa...");
  for (const e of ETAPAS) {
    const { rowCount } = await client.query(
      `INSERT INTO lead_score_rules (event_type, condition, points, description)
       VALUES ('lead_stage_changed', $1::jsonb, $2, $3)
       ON CONFLICT DO NOTHING`,
      [JSON.stringify({ para: e.slug }), e.pontos, `Chegou em ${e.label}`]
    );
    console.log(
      `[MIGRATE]   ${e.label}: ${rowCount ? `${e.pontos} pontos` : "já tinha regra — preservada"}`
    );
  }

  await client.query(
    `INSERT INTO app_settings (key, value) VALUES ('pipedrive_funis', $1)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(FUNIS)]
  );
  console.log(`[MIGRATE] funis acompanhados: ${JSON.stringify(FUNIS)}`);

  const { rowCount: marcas } = await client.query(
    `DELETE FROM app_settings
      WHERE key = 'pipedrive_sync_desde' OR key LIKE 'pipedrive_sync_desde:%'`
  );
  console.log(
    `[MIGRATE] ${marcas ?? 0} marca(s)-d'água apagada(s) — a próxima sincronização relê os funis`
  );

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
