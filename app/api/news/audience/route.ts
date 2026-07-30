import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, lists } from "@/lib/db";
import {
  AVANTE_NEWS_LIST_KEY,
  resolveNewsList,
  setSetting,
} from "@/lib/settings";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Lista de parceiros White Label Ativos que recebe o Avante News. */
export async function GET() {
  try {
    const audience = await resolveNewsList();
    return NextResponse.json({ audience });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const listId = typeof body.listId === "string" ? body.listId.trim() : "";

    if (!listId) {
      return NextResponse.json(
        { error: "Escolha a lista de parceiros White Label Ativos." },
        { status: 400 }
      );
    }

    const [list] = await db
      .select({ id: lists.id })
      .from(lists)
      .where(eq(lists.id, listId));

    if (!list) {
      return NextResponse.json(
        { error: "Lista não encontrada." },
        { status: 400 }
      );
    }

    await setSetting(AVANTE_NEWS_LIST_KEY, list.id);

    return NextResponse.json({ audience: await resolveNewsList() });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
