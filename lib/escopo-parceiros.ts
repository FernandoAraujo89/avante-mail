// O Sucesso do cliente enxerga só PARCEIROS: nem os leads (contato com etapa
// do funil) nem a lista de leads aparecem para ele, e ele não consegue mexer
// neles por nenhuma rota. O middleware decide QUAIS rotas o perfil abre; este
// módulo decide O QUE ele vê dentro delas.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { cookies } from "next/headers";

import { contacts, getDb, lists } from "@/lib/db";
import {
  SESSION_COOKIE,
  verifySessionToken,
  type SessionUser,
} from "@/lib/session";

type Db = ReturnType<typeof getDb>;

/** Usuário da sessão, para páginas do servidor (as rotas usam a requisição). */
export async function usuarioDaSessao(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

/** Este usuário só pode ver parceiros? (Sem sessão, o mais restrito.) */
export function veSoParceiros(user: SessionUser | null): boolean {
  return user?.role !== "admin";
}

/** Lista marcada (hoje só a de leads) — fora do alcance de quem vê só parceiros. */
export async function listaEhRestrita(db: Db, listId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.id, listId), isNotNull(lists.kind)));
  return Boolean(row);
}

/** Ids, entre os informados, de listas restritas. */
export async function listasRestritas(db: Db, listIds: string[]): Promise<string[]> {
  if (listIds.length === 0) return [];
  const rows = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(inArray(lists.id, listIds), isNotNull(lists.kind)));
  return rows.map((r) => r.id);
}

/** O contato é lead? (Inexistente conta como não.) */
export async function contatoEhLead(db: Db, contactId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), isNotNull(contacts.stage)));
  return Boolean(row);
}
