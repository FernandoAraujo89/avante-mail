import { asc, eq } from "drizzle-orm";

import { getDb, leadStages, type LeadStageRow } from "@/lib/db";
import { ETAPA_DE_ENTRADA, slugDaEtapa } from "@/components/leads/estagios";

// Reexportados daqui para o servidor ter um lugar só de onde importar.
export { ETAPA_DE_ENTRADA, slugDaEtapa };

/**
 * As etapas do funil, que espelham o Pipedrive e chegam por webhook.
 *
 * Ponto único de leitura: a tela, o webhook e o motor precisam concordar sobre
 * quais slugs existem e qual deles encerra a nutrição. Duas listas divergiriam
 * no dia em que alguém cadastrasse uma etapa e esquecesse de um dos lados.
 */

export async function listarEtapas(
  incluirInativas = false
): Promise<LeadStageRow[]> {
  const db = getDb();
  const consulta = db.select().from(leadStages);
  const linhas = await (incluirInativas
    ? consulta
    : consulta.where(eq(leadStages.active, true))
  ).orderBy(asc(leadStages.position), asc(leadStages.label));
  return linhas;
}

export async function etapaPorSlug(
  slug: string
): Promise<LeadStageRow | null> {
  const db = getDb();
  const [linha] = await db
    .select()
    .from(leadStages)
    .where(eq(leadStages.slug, slug))
    .limit(1);
  return linha ?? null;
}

/**
 * Casamento PURO, sobre uma lista já carregada — é o que a sincronização com o
 * Pipedrive usa em lote, sem uma consulta por deal.
 *
 * Três formas, nesta ordem: o slug, o rótulo por extenso, e os APELIDOS —
 * outros nomes da mesma etapa. É por eles que o "Em análise/Agendar
 * apresentação" do funil SDR-TESTE-NRG cai na etapa que o White Label -
 * Inbound chama de "Agendar apresentação parte técnica".
 */
export function casarEtapa(
  etapas: LeadStageRow[],
  valor: string
): LeadStageRow | null {
  const alvo = slugDaEtapa(valor);
  if (!alvo) return null;
  return (
    etapas.find((e) => e.slug === alvo) ??
    etapas.find((e) => slugDaEtapa(e.label) === alvo) ??
    etapas.find((e) =>
      (e.aliases ?? []).some((a) => slugDaEtapa(a) === alvo)
    ) ??
    null
  );
}

/**
 * Quantos chegaram PELO MENOS até cada etapa — o funil que só desce.
 *
 * `alcances` traz, por contato, a posição mais funda que ele já alcançou: a
 * etapa de agora ou qualquer "chegou em" da linha do tempo. Contar só quem
 * chegou em cada etapa exata daria um funil que sobe e desce — quem o vendedor
 * arrastou de "Realizar contato" direto para a proposta não teria passado,
 * na conta, pelas etapas do meio, e a taxa de avanço passaria de 100%.
 */
export function passaramPorEtapa(
  posicoes: number[],
  alcances: number[]
): number[] {
  return posicoes.map((posicao) => alcances.filter((a) => a >= posicao).length);
}

/**
 * Acha a etapa que o webhook quis dizer: pelo slug, pelo rótulo escrito por
 * extenso ou por um apelido. Devolve null quando não existe — quem chama
 * decide o que fazer, e a escolha em `entrada.ts` é registrar a recusa sem
 * perder o resto da entrega.
 */
export async function resolverEtapa(
  valor: string
): Promise<LeadStageRow | null> {
  const etapas = await listarEtapas(true);
  return casarEtapa(etapas, valor);
}
