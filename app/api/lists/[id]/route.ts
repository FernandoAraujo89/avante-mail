import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { contactLists, contacts, getDb, lists } from "@/lib/db";
import { listaEhRestrita, veSoParceiros } from "@/lib/escopo-parceiros";
import { naoEhLead } from "@/lib/leads";
import { sessionUserFromRequest } from "@/lib/session";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function naoEncontrada() {
  return NextResponse.json({ error: "Lista não encontrada." }, { status: 404 });
}

/** A lista de leads fica invisível para quem vê só parceiros. */
async function foraDoAlcance(
  request: NextRequest,
  db: ReturnType<typeof getDb>,
  id: string
): Promise<boolean> {
  return (
    veSoParceiros(await sessionUserFromRequest(request)) &&
    (await listaEhRestrita(db, id))
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    if (await foraDoAlcance(request, db, id)) return naoEncontrada();
    const soParceiros = veSoParceiros(await sessionUserFromRequest(request));

    const [list] = await db.select().from(lists).where(eq(lists.id, id));
    if (!list) {
      return NextResponse.json(
        { error: "Lista não encontrada." },
        { status: 404 }
      );
    }

    const members = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        company: contacts.company,
        subscribed: contacts.subscribed,
        createdAt: contacts.createdAt,
      })
      .from(contactLists)
      .innerJoin(contacts, eq(contacts.id, contactLists.contactId))
      .where(
        soParceiros
          ? and(eq(contactLists.listId, id), naoEhLead())
          : eq(contactLists.listId, id)
      )
      .orderBy(desc(contacts.createdAt));

    return NextResponse.json({ list, contacts: members });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const body = await request.json();
    if (await foraDoAlcance(request, db, id)) return naoEncontrada();

    const updates: Partial<typeof lists.$inferInsert> = {};

    if (typeof body.name === "string") {
      if (!body.name.trim()) {
        return NextResponse.json(
          { error: "O nome não pode ficar vazio." },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }
    if ("description" in body) {
      updates.description =
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim()
          : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Nenhum campo para atualizar." },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(lists)
      .set(updates)
      .where(eq(lists.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Lista não encontrada." },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    if (await foraDoAlcance(request, db, id)) return naoEncontrada();

    // Remover a lista não apaga contatos — só as associações (cascade).
    const [deleted] = await db
      .delete(lists)
      .where(eq(lists.id, id))
      .returning({ id: lists.id });

    if (!deleted) {
      return NextResponse.json(
        { error: "Lista não encontrada." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
