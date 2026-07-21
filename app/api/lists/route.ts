import { NextRequest, NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";

import { contactLists, getDb, lists } from "@/lib/db";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: lists.id,
        name: lists.name,
        description: lists.description,
        createdAt: lists.createdAt,
        contactCount: sql<number>`count(${contactLists.contactId})`.mapWith(
          Number
        ),
      })
      .from(lists)
      .leftJoin(contactLists, eq(contactLists.listId, lists.id))
      .groupBy(lists.id)
      .orderBy(asc(lists.name));

    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;

    if (!name) {
      return NextResponse.json(
        { error: "O nome da lista é obrigatório." },
        { status: 400 }
      );
    }

    const [created] = await db
      .insert(lists)
      .values({ name, description })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
