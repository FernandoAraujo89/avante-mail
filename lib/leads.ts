import { eq, isNotNull, isNull, asc, type SQL } from "drizzle-orm";

import { contacts, getDb, lists } from "@/lib/db";

/**
 * As travas contra disparo acidental (docs/plano-webhooks-leads.md, seção 5).
 *
 * Lead e parceiro moram na mesma tabela `contacts`, então "montar uma campanha,
 * deixar todas as listas e disparar para os leads sem querer" é um clique a
 * menos, não um erro difícil. Estas funções são o ponto único onde "quem é
 * lead" fica definido — usá-las é o que impede a resposta divergir entre a
 * contagem da tela e o que o envio realmente faz.
 *
 * A definição é `contacts.stage`, e não "está na lista Leads", de propósito: um
 * PARCEIRO que preenche um formulário do site entra na lista de leads pelo
 * webhook, mas continua com `stage` nulo (a entrada não sobrescreve contato
 * existente). Pela lista, ele sumiria calado das campanhas de parceiro; pelo
 * estágio, ele segue parceiro — que é o que ele é.
 */

/** Condição SQL: o contato NÃO é lead (é parceiro/contato comum). */
export function naoEhLead(): SQL {
  return isNull(contacts.stage);
}

/** Condição SQL: o contato É lead. */
export function ehLead(): SQL {
  return isNotNull(contacts.stage);
}

export interface ListaDeLeads {
  id: string;
  name: string;
}

/**
 * A lista marcada como `kind = 'leads'` — o único destino válido para um lead.
 * Havendo mais de uma, vale a mais antiga (a criada pelo script de origem).
 * null = ninguém marcou nenhuma ainda; quem chama decide o que fazer.
 */
export async function resolveListaDeLeads(): Promise<ListaDeLeads | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: lists.id, name: lists.name })
    .from(lists)
    .where(eq(lists.kind, "leads"))
    .orderBy(asc(lists.createdAt))
    .limit(1);
  return row ?? null;
}

/** Ids de todas as listas de leads — para excluí-las de um seletor. */
export async function idsDasListasDeLeads(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: lists.id })
    .from(lists)
    .where(eq(lists.kind, "leads"));
  return rows.map((r) => r.id);
}
