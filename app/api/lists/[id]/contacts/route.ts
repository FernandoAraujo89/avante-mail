import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { contactLists, getDb, lists } from "@/lib/db";
import { errorMessage, normalizeIds } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function listExists(
  db: ReturnType<typeof getDb>,
  id: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: lists.id })
    .from(lists)
    .where(eq(lists.id, id));
  return Boolean(row);
}

// Adiciona contatos existentes à lista.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const body = await request.json().catch(() => ({}));
    const ids = normalizeIds(body.ids);

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Nenhum contato informado." },
        { status: 400 }
      );
    }
    if (!(await listExists(db, id))) {
      return NextResponse.json(
        { error: "Lista não encontrada." },
        { status: 404 }
      );
    }

    const added = await db
      .insert(contactLists)
      .values(ids.map((contactId) => ({ contactId, listId: id })))
      .onConflictDoNothing()
      .returning({ contactId: contactLists.contactId });

    return NextResponse.json({ added: added.length });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

// Remove contatos da lista (não apaga os contatos, só a associação).
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const body = await request.json().catch(() => ({}));
    const ids = normalizeIds(body.ids);

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Nenhum contato informado." },
        { status: 400 }
      );
    }

    const removed = await db
      .delete(contactLists)
      .where(
        and(
          eq(contactLists.listId, id),
          inArray(contactLists.contactId, ids)
        )
      )
      .returning({ contactId: contactLists.contactId });

    return NextResponse.json({ removed: removed.length });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
