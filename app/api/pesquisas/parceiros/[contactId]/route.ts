import { NextRequest, NextResponse } from "next/server";

import { ehTier, salvarPerfil } from "@/lib/pesquisas/mapeamento-db";
import { frentesDoParceiro } from "@/lib/pesquisas/relatorio-db";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ contactId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { contactId } = await context.params;
    const parceiro = UUID_REGEX.test(contactId) ? await frentesDoParceiro(contactId) : null;
    if (!parceiro) {
      return NextResponse.json({ error: "Parceiro não encontrado." }, { status: 404 });
    }
    return NextResponse.json(parceiro);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/** { tier?, ownerUserId?, notes? } — classificação, responsável e notas da Expansão. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { contactId } = await context.params;
    if (!UUID_REGEX.test(contactId)) {
      return NextResponse.json({ error: "Parceiro não encontrado." }, { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      tier?: unknown;
      ownerUserId?: unknown;
      notes?: unknown;
    };
    const patch: Parameters<typeof salvarPerfil>[1] = {};
    if ("tier" in body) {
      if (body.tier !== null && !ehTier(body.tier)) {
        return NextResponse.json({ error: "Classificação inválida." }, { status: 400 });
      }
      patch.tier = body.tier;
    }
    if ("ownerUserId" in body) {
      if (body.ownerUserId !== null && !(typeof body.ownerUserId === "string" && UUID_REGEX.test(body.ownerUserId))) {
        return NextResponse.json({ error: "Responsável inválido." }, { status: 400 });
      }
      patch.ownerUserId = body.ownerUserId as string | null;
    }
    if ("notes" in body) {
      patch.notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;
    }
    const resultado = await salvarPerfil(contactId, patch);
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
