import { NextRequest, NextResponse } from "next/server";
import {
  and,
  arrayContains,
  arrayOverlaps,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  type SQL,
} from "drizzle-orm";

import { contacts, getDb } from "@/lib/db";
import { EMAIL_REGEX, errorMessage, normalizeTags } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const params = request.nextUrl.searchParams;

    const search = params.get("search")?.trim();
    const segment = params.get("segment");
    const segments = params
      .get("segments")
      ?.split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "todos");
    const tag = params.get("tag")?.trim();
    const tags = params
      .get("tags")
      ?.split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const subscribed = params.get("subscribed");
    const countOnly = params.get("count") === "true";

    const conditions: SQL[] = [];

    if (search) {
      const term = `%${search}%`;
      const searchCondition = or(
        ilike(contacts.name, term),
        ilike(contacts.email, term),
        ilike(contacts.company, term)
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    if (segments && segments.length > 0) {
      conditions.push(inArray(contacts.segment, segments));
    } else if (segment && segment !== "todos") {
      conditions.push(eq(contacts.segment, segment));
    }
    if (tag) {
      conditions.push(arrayContains(contacts.tags, [tag]));
    }
    if (tags && tags.length > 0) {
      conditions.push(arrayOverlaps(contacts.tags, tags));
    }
    if (subscribed === "true") conditions.push(eq(contacts.subscribed, true));
    if (subscribed === "false") conditions.push(eq(contacts.subscribed, false));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    if (countOnly) {
      const [row] = await db
        .select({ count: count() })
        .from(contacts)
        .where(where);
      return NextResponse.json({ count: row.count });
    }

    const data = await db
      .select()
      .from(contacts)
      .where(where)
      .orderBy(desc(contacts.createdAt));

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json().catch(() => ({}));

    const rawIds: unknown[] = Array.isArray(body.ids) ? body.ids : [];
    const ids = [
      ...new Set(
        rawIds.filter((id): id is string => typeof id === "string")
      ),
    ];

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Nenhum contato selecionado." },
        { status: 400 }
      );
    }

    const deleted = await db
      .delete(contacts)
      .where(inArray(contacts.id, ids))
      .returning({ id: contacts.id });

    return NextResponse.json({ deleted: deleted.length });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const company =
      typeof body.company === "string" && body.company.trim()
        ? body.company.trim()
        : null;
    const segment =
      typeof body.segment === "string" && body.segment ? body.segment : null;
    const tags = normalizeTags(body.tags);

    if (!name) {
      return NextResponse.json(
        { error: "O nome é obrigatório." },
        { status: 400 }
      );
    }
    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json(
        { error: "Informe um e-mail válido." },
        { status: 400 }
      );
    }

    const existing = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, email));

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Já existe um contato com este e-mail." },
        { status: 409 }
      );
    }

    const [created] = await db
      .insert(contacts)
      .values({
        name,
        email,
        company,
        segment,
        tags,
        subscribed: body.subscribed !== false,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
