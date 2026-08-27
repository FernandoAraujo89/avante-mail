import { asc, eq } from "drizzle-orm";

import { getDb, leadQualifications, type LeadQualificationRow } from "@/lib/db";
import { slugDaEtapa } from "@/components/leads/estagios";

/**
 * As qualificações do lead, que espelham o campo "Lead qualificado" do
 * Pipedrive e chegam por webhook.
 *
 * Ponto único de leitura, como `lib/leads/etapas.ts` é para as etapas: a
 * tela, o webhook e a pontuação precisam concordar sobre quais slugs existem.
 */

export async function listarQualificacoes(
  incluirInativas = false
): Promise<LeadQualificationRow[]> {
  const db = getDb();
  const consulta = db.select().from(leadQualifications);
  const linhas = await (incluirInativas
    ? consulta
    : consulta.where(eq(leadQualifications.active, true))
  ).orderBy(asc(leadQualifications.position), asc(leadQualifications.label));
  return linhas;
}

export async function qualificacaoPorSlug(
  slug: string
): Promise<LeadQualificationRow | null> {
  const db = getDb();
  const [linha] = await db
    .select()
    .from(leadQualifications)
    .where(eq(leadQualifications.slug, slug))
    .limit(1);
  return linha ?? null;
}

/**
 * Casa o que o agente mandou com uma qualificação cadastrada.
 *
 * Aceita o slug (`alto_potencial`), o rótulo por extenso ("Promissor: Alto
 * potencial") e o rótulo com prefixo de resposta ("Sim: Experiente" quando só
 * "Experiente" está cadastrado) — o agente manda texto de conversa, não
 * identificador, e recusar por causa de um acento perderia a informação toda.
 *
 * As passadas rodam NESTA ordem, cada uma sobre a lista inteira: o casamento
 * exato de "nao-identificado" precisa vencer antes que a passada de prefixo
 * o entregue para "nao". Devolve null quando não existe — quem chama decide,
 * e a escolha em `entrada.ts` é registrar a recusa sem perder o resto.
 */
export async function resolverQualificacao(
  valor: string
): Promise<LeadQualificationRow | null> {
  const alvo = slugDaEtapa(valor);
  if (!alvo) return null;
  const lista = await listarQualificacoes(true);

  // Slugs antigos usam sublinhado (`alto_potencial`); os novos, hífen. A
  // comparação normaliza os dois lados para as duas gerações casarem.
  const comSlug = lista.map((q) => ({ q, slug: slugDaEtapa(q.slug) }));

  const porSlug = comSlug.find((c) => c.slug === alvo);
  if (porSlug) return porSlug.q;

  const porRotulo = comSlug.find((c) => slugDaEtapa(c.q.label) === alvo);
  if (porRotulo) return porRotulo.q;

  const porPedaco = comSlug.find(
    (c) => alvo.endsWith(`-${c.slug}`) || alvo.startsWith(`${c.slug}-`)
  );
  return porPedaco?.q ?? null;
}
