import { asc, eq, ilike, sql, type SQL } from "drizzle-orm";

import { appSettings, contactLists, getDb, lists } from "@/lib/db";

/** Chave da lista de parceiros White Label Ativos — destino do Avante News. */
export const AVANTE_NEWS_LIST_KEY = "avante_news_list_id";

/** Chave da lista de colaboradores — destino OPCIONAL do Avante News. */
export const AVANTE_NEWS_TEAM_LIST_KEY = "avante_news_team_list_id";

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

// Uma query nova por chamada: o builder do Drizzle é mutável e não pode ser
// reaproveitado entre dois .where() diferentes.
function listWithCount(where: SQL) {
  const db = getDb();
  return db
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
}

/**
 * Lista guardada em app_settings; sem configuração (ou se a lista tiver sido
 * apagada), deduz pelo nome. `prefer` desempata entre as candidatas.
 * Retorna null quando não há nenhuma: aí o usuário escolhe na tela.
 */
async function resolveConfiguredList(
  settingKey: string,
  namePattern: string,
  prefer?: RegExp
): Promise<NewsAudience | null> {
  const configuredId = await getSetting(settingKey);

  if (configuredId) {
    const [row] = await listWithCount(eq(lists.id, configuredId));
    if (row) return { ...row, auto: false };
    // Lista configurada foi apagada: cai no palpite abaixo.
  }

  const candidates = await listWithCount(ilike(lists.name, namePattern)).orderBy(
    asc(lists.name)
  );
  if (candidates.length === 0) return null;

  const preferred = prefer
    ? candidates.find((l) => prefer.test(l.name))
    : undefined;
  return { ...(preferred ?? candidates[0]), auto: true };
}

/** Lista de parceiros que recebe o Avante News (público principal). */
export function resolveNewsList(): Promise<NewsAudience | null> {
  return resolveConfiguredList(AVANTE_NEWS_LIST_KEY, "%white label%", /ativ/i);
}

/**
 * Lista de colaboradores — público OPCIONAL do Avante News, escolhido por
 * edição. null = não há lista de colaboradores, e a opção nem aparece.
 */
export function resolveTeamList(): Promise<NewsAudience | null> {
  return resolveConfiguredList(AVANTE_NEWS_TEAM_LIST_KEY, "%colaborador%");
}
