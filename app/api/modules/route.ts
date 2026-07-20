import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";

import { getDb, modules } from "@/lib/db";
import { isValidRow } from "@/lib/email-builder/compile";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const data = await db
      .select()
      .from(modules)
      .orderBy(desc(modules.createdAt));
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "O nome do módulo é obrigatório." },
        { status: 400 }
      );
    }
    if (!isValidRow(body.design)) {
      return NextResponse.json(
        { error: "Estrutura do módulo inválida." },
        { status: 400 }
      );
    }

    const [created] = await db
      .insert(modules)
      .values({ name, design: body.design })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
