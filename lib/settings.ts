import { asc, eq, ilike, sql, type SQL } from "drizzle-orm";

import { appSettings, contactLists, getDb, lists } from "@/lib/db";

/** Chave da lista de parceiros White Label Ativos — destino do Avante News. */
export const AVANTE_NEWS_LIST_KEY = "avante_news_list_id";

export async function getSetting(key: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key));
  return row?.value ?? null;
}

export async function setSetting(
  key: string,
  value: string | null
): Promise<void> {
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

export interface NewsAudience {
  id: string;
  name: string;
  contactCount: number;
  /** true = lista deduzida pelo nome, ainda não confirmada pelo usuário. */
  auto: boolean;
}

/**
 * Lista que recebe o Avante News. Usa a configurada; se ainda não houver
 * configuração (ou a lista tiver sido apagada), deduz pelo nome — qualquer
 * lista com "white label", preferindo a que também tenha "ativ".
 * Retorna null quando não há nenhuma candidata: aí o usuário escolhe na tela.
 */
export async function resolveNewsList(): Promise<NewsAudience | null> {
  const db = getDb();
  const configuredId = await getSetting(AVANTE_NEWS_LIST_KEY);

  // Uma query nova por chamada: o builder do Drizzle é mutável e não pode ser
  // reaproveitado entre dois .where() diferentes.
  const withCount = (where: SQL) =>
    db
      .select({
        id: lists.id,
        name: lists.name,
        contactCount: sql<number>`count(${contactLists.contactId})`.mapWith(
          Number
        ),
      })
      .from(lists)
      .leftJoin(contactLists, eq(contactLists.listId, lists.id))
      .where(where)
      .groupBy(lists.id);

  if (configuredId) {
    const [row] = await withCount(eq(lists.id, configuredId));
    if (row) return { ...row, auto: false };
    // Lista configurada foi apagada: cai no palpite abaixo.
  }

  const candidates = await withCount(ilike(lists.name, "%white label%")).orderBy(
    asc(lists.name)
  );

  if (candidates.length === 0) return null;

  const active = candidates.find((l) => /ativ/i.test(l.name));
  return { ...(active ?? candidates[0]), auto: true };
}
