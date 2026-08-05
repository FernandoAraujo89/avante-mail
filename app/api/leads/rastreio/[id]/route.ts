import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, siteEventRules } from "@/lib/db";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Liga/desliga a regra sem perder o cadastro. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const [atualizada] = await getDb()
      .update(siteEventRules)
      .set({ active: body.active === true })
      .where(eq(siteEventRules.id, id))
      .returning();

    if (!atualizada) {
      return NextResponse.json(
        { error: "Regra não encontrada." },
        { status: 404 }
      );
    }
    return NextResponse.json({ regra: atualizada });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    // Os eventos já gravados FICAM: eles são histórico do lead, e apagar a
    // regra não pode reescrever o que aconteceu. A regra só deixa de produzir
    // eventos novos.
    const apagadas = await getDb()
      .delete(siteEventRules)
      .where(eq(siteEventRules.id, id))
      .returning({ id: siteEventRules.id });

    if (apagadas.length === 0) {
      return NextResponse.json(
        { error: "Regra não encontrada." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
