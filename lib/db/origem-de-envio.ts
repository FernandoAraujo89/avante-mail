// A restrição de origem de campaign_sends (campaign_sends_origem_check): todo
// envio precisa vir de uma campanha, de um percurso/passo de automação ou de
// um convite de pesquisa — envio sem origem é cobrado e invisível em relatório.
//
// Três migrações mexem nela (migrate-automation-sends, migrate-campaign-sends-
// origem e migrate-sends-pesquisa) e o loop do deploy roda TODAS, em ordem
// alfabética, a cada deploy. Cada uma tinha a própria lista de colunas, e a
// mais antiga recriava a restrição sem a cláusula da pesquisa: no primeiro
// deploy depois dos primeiros convites reais (29/10/2026), a recriação falhou
// e a tabela ficou sem restrição. Por isso a definição é uma só, montada a
// partir das colunas que EXISTEM no momento em que cada migração roda.

/** Colunas que identificam a origem de um envio, na ordem em que surgiram. */
export const COLUNAS_DE_ORIGEM = [
  "campaign_id",
  "automation_run_id",
  "automation_step_id",
  "survey_invite_id",
] as const;

/** Expressão do CHECK para as colunas de origem que existem na tabela. */
export function expressaoDeOrigem(colunasExistentes: readonly string[]): string {
  const presentes = COLUNAS_DE_ORIGEM.filter((c) => colunasExistentes.includes(c));
  if (presentes.length === 0) {
    throw new Error("campaign_sends sem nenhuma coluna de origem: a migração base não rodou.");
  }
  return presentes.map((c) => `${c} IS NOT NULL`).join(" OR ");
}

type Consultavel = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

/** Lê as colunas de origem que já existem em campaign_sends. */
export async function colunasDeOrigemExistentes(client: Consultavel): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'campaign_sends'
        AND column_name = ANY($1::text[])`,
    [[...COLUNAS_DE_ORIGEM]]
  );
  return rows.map((r) => String(r.column_name));
}

/**
 * Recria a restrição num único ALTER TABLE (atômico: se o CHECK falhar, a
 * restrição antiga continua lá, em vez de sumir).
 */
export async function recriarRestricaoDeOrigem(client: Consultavel): Promise<string> {
  const expressao = expressaoDeOrigem(await colunasDeOrigemExistentes(client));
  await client.query(
    `ALTER TABLE campaign_sends
       DROP CONSTRAINT IF EXISTS campaign_sends_origem_check,
       ADD CONSTRAINT campaign_sends_origem_check CHECK (${expressao})`
  );
  return expressao;
}
