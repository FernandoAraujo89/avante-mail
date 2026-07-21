import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { contactLists, contacts, getDb } from "@/lib/db";
import {
  EMAIL_REGEX,
  errorMessage,
  normalizeIds,
  normalizeTags,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id));

    if (!contact) {
      return NextResponse.json(
        { error: "Contato não encontrado." },
        { status: 404 }
      );
    }

    const memberships = await db
      .select({ listId: contactLists.listId })
      .from(contactLists)
      .where(eq(contactLists.contactId, id));

    return NextResponse.json({
      ...contact,
      listIds: memberships.map((m) => m.listId),
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const body = await request.json();

    const updates: Partial<typeof contacts.$inferInsert> = {};

    if (typeof body.name === "string") {
      if (!body.name.trim()) {
        return NextResponse.json(
          { error: "O nome não pode ficar vazio." },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }
    if (typeof body.email === "string") {
      const email = body.email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(email)) {
        return NextResponse.json(
          { error: "Informe um e-mail válido." },
          { status: 400 }
        );
      }
      updates.email = email;
    }
    if ("company" in body) {
      updates.company =
        typeof body.company === "string" && body.company.trim()
          ? body.company.trim()
          : null;
    }
    if ("tags" in body) {
      updates.tags = normalizeTags(body.tags);
    }
    if (typeof body.subscribed === "boolean") {
      updates.subscribed = body.subscribed;
    }

    const changesLists = "listIds" in body;

    if (Object.keys(updates).length === 0 && !changesLists) {
      return NextResponse.json(
        { error: "Nenhum campo para atualizar." },
        { status: 400 }
      );
    }

    let contact = null;
    if (Object.keys(updates).length > 0) {
      const [updated] = await db
        .update(contacts)
        .set(updates)
        .where(eq(contacts.id, id))
        .returning();
      contact = updated ?? null;
    } else {
      const [existing] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, id));
      contact = existing ?? null;
    }

    if (!contact) {
      return NextResponse.json(
        { error: "Contato não encontrado." },
        { status: 404 }
      );
    }

    // Substitui as associações de lista pelo conjunto informado.
    if (changesLists) {
      const listIds = normalizeIds(body.listIds);
      await db.delete(contactLists).where(eq(contactLists.contactId, id));
      if (listIds.length > 0) {
        await db
          .insert(contactLists)
          .values(listIds.map((listId) => ({ contactId: id, listId })))
          .onConflictDoNothing();
      }
    }

    return NextResponse.json(contact);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const [deleted] = await db
      .delete(contacts)
      .where(eq(contacts.id, id))
      .returning({ id: contacts.id });

    if (!deleted) {
      return NextResponse.json(
        { error: "Contato não encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
