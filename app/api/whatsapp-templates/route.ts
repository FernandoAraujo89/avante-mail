import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { getDb, whatsappTemplates } from "@/lib/db";
import { errorMessage } from "@/lib/utils";
import { parseTemplateInput } from "@/lib/whatsapp/template-input";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const data = await db
      .select()
      .from(whatsappTemplates)
      .orderBy(desc(whatsappTemplates.createdAt));
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

// Cria o modelo como rascunho local. O envio para análise da Meta é uma ação
// separada (POST /api/whatsapp-templates/[id]/submit) — assim dá para montar
// o catálogo antes mesmo de a conta Meta estar configurada.
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const parsed = parseTemplateInput(await request.json());
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const existing = await db
      .select({ id: whatsappTemplates.id })
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.name, parsed.data.name));
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Já existe um modelo com este nome." },
        { status: 409 }
      );
    }

    const [created] = await db
      .insert(whatsappTemplates)
      .values(parsed.data)
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
