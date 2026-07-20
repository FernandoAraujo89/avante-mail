import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, templates } from "@/lib/db";
import { compileDesignToMjml, isValidDesign } from "@/lib/email-builder/compile";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const [template] = await db
      .select()
      .from(templates)
      .where(eq(templates.id, id));

    if (!template) {
      return NextResponse.json(
        { error: "Template não encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json(template);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const body = await request.json();

    const updates: Partial<typeof templates.$inferInsert> = {};

    if (typeof body.name === "string") {
      if (!body.name.trim()) {
        return NextResponse.json(
          { error: "O nome não pode ficar vazio." },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }
    if ("category" in body) {
      updates.category =
        typeof body.category === "string" && body.category
          ? body.category
          : null;
    }
    if (body.design !== undefined && body.design !== null) {
      if (!isValidDesign(body.design)) {
        return NextResponse.json(
          { error: "Design do template inválido." },
          { status: 400 }
        );
      }
      updates.design = body.design;
      updates.editorType = "builder";
      updates.mjmlContent = compileDesignToMjml(body.design);
    } else if (typeof body.mjmlContent === "string") {
      if (!body.mjmlContent.trim()) {
        return NextResponse.json(
          { error: "O conteúdo do template não pode ficar vazio." },
          { status: 400 }
        );
      }
      updates.mjmlContent = body.mjmlContent;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Nenhum campo para atualizar." },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(templates)
      .set(updates)
      .where(eq(templates.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Template não encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    // Campanhas que usam este template ficam com template_id = null
    // (FK com onDelete: set null) — não são apagadas.
    const [deleted] = await db
      .delete(templates)
      .where(eq(templates.id, id))
      .returning({ id: templates.id });

    if (!deleted) {
      return NextResponse.json(
        { error: "Template não encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
