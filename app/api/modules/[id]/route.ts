import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, modules } from "@/lib/db";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const [deleted] = await db
      .delete(modules)
      .where(eq(modules.id, id))
      .returning({ id: modules.id });

    if (!deleted) {
      return NextResponse.json(
        { error: "Módulo não encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
