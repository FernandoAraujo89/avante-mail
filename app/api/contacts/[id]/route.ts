import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";

import { contactLists, contacts, getDb } from "@/lib/db";
import { emitContactEvent, emitListDiff, emitTagDiff } from "@/lib/events";
import { normalizePhone } from "@/lib/phone";
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

    // O estado atual guia as transições de consentimento de WhatsApp.
    const [existing] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id));
    if (!existing) {
      return NextResponse.json(
        { error: "Contato não encontrado." },
        { status: 404 }
      );
    }

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

    if ("phone" in body) {
      const raw = typeof body.phone === "string" ? body.phone.trim() : "";
      if (!raw) {
        updates.phone = null;
      } else {
        const phone = normalizePhone(raw);
        if (!phone) {
          return NextResponse.json(
            {
              error: "Informe um telefone válido com DDD (ex.: 48 99999-9999).",
            },
            { status: 400 }
          );
        }
        if (phone !== existing.phone) {
          const samePhone = await db
            .select({ id: contacts.id })
            .from(contacts)
            .where(and(eq(contacts.phone, phone), ne(contacts.id, id)));
          if (samePhone.length > 0) {
            return NextResponse.json(
              { error: "Já existe um contato com este telefone." },
              { status: 409 }
            );
          }
        }
        updates.phone = phone;
      }
    }

    if (typeof body.whatsappSubscribed === "boolean") {
      const phoneAfter = "phone" in updates ? updates.phone : existing.phone;
      const enable = body.whatsappSubscribed && Boolean(phoneAfter);
      if (enable !== existing.whatsappSubscribed) {
        updates.whatsappSubscribed = enable;
        if (enable) {
          // Preserva a data do primeiro consentimento (prova LGPD).
          updates.whatsappOptInAt = existing.whatsappOptInAt ?? new Date();
          updates.whatsappOptOutAt = null;
        } else {
          updates.whatsappOptOutAt = new Date();
        }
      }
    }

    // Sem telefone não há como manter o consentimento de WhatsApp.
    if ("phone" in updates && updates.phone === null) {
      const wasSubscribed =
        updates.whatsappSubscribed ?? existing.whatsappSubscribed;
      if (wasSubscribed) {
        updates.whatsappSubscribed = false;
        updates.whatsappOptOutAt = new Date();
      }
    }

    const changesLists = "listIds" in body;

    // As listas atuais precisam ser lidas ANTES da troca — sem elas não dá
    // para saber em quais o contato entrou e de quais saiu.
    const listasAntes = changesLists
      ? (
          await db
            .select({ listId: contactLists.listId })
            .from(contactLists)
            .where(eq(contactLists.contactId, id))
        ).map((l) => l.listId)
      : [];

    if (Object.keys(updates).length === 0 && !changesLists) {
      return NextResponse.json(
        { error: "Nenhum campo para atualizar." },
        { status: 400 }
      );
    }

    let contact = existing;
    if (Object.keys(updates).length > 0) {
      const [updated] = await db
        .update(contacts)
        .set(updates)
        .where(eq(contacts.id, id))
        .returning();
      contact = updated ?? existing;
    }

    // Substitui as associações de lista pelo conjunto informado.
    let listasDepois = listasAntes;
    if (changesLists) {
      const listIds = normalizeIds(body.listIds);
      await db.delete(contactLists).where(eq(contactLists.contactId, id));
      if (listIds.length > 0) {
        await db
          .insert(contactLists)
          .values(listIds.map((listId) => ({ contactId: id, listId })))
          .onConflictDoNothing();
      }
      listasDepois = listIds;
    }

    // Registra o que MUDOU — é disso que os gatilhos das automações vivem.
    if ("tags" in updates) {
      await emitTagDiff(id, existing.tags, updates.tags);
    }
    if (changesLists) {
      await emitListDiff(id, listasAntes, listasDepois);
    }
    if (updates.subscribed === false && existing.subscribed) {
      await emitContactEvent("email_unsubscribed", id);
    }
    if (updates.whatsappSubscribed === false && existing.whatsappSubscribed) {
      await emitContactEvent("whatsapp_unsubscribed", id);
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
