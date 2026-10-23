import { NextRequest, NextResponse } from "next/server";

import { tratarAlerta } from "@/lib/pesquisas/mapeamento-db";
import { sessionUserFromRequest } from "@/lib/session";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ alertaId: string }> };

/** { acao: "tratar", note?: string } — a Expansão fez o contato. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { alertaId } = await context.params;
    if (!UUID_REGEX.test(alertaId)) {
      return NextResponse.json({ error: "Alerta não encontrado." }, { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as { acao?: unknown; note?: unknown };
    if (body.acao !== "tratar") {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }
    const user = await sessionUserFromRequest(request);
    const resultado = await tratarAlerta(
      alertaId,
      user ? { id: user.id, name: user.name } : null,
      typeof body.note === "string" ? body.note : null
    );
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
