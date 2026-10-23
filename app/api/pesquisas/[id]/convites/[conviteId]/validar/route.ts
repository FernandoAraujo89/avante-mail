import { NextRequest, NextResponse } from "next/server";

import { desfazerValidacao, validarConvite } from "@/lib/pesquisas/mapeamento-db";
import { sessionUserFromRequest } from "@/lib/session";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; conviteId: string }> };

/** Etapa 5: a Expansão validou os dados desta resposta concluída. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id, conviteId } = await context.params;
    if (!UUID_REGEX.test(id) || !UUID_REGEX.test(conviteId)) {
      return NextResponse.json({ error: "Convite não encontrado." }, { status: 404 });
    }
    const user = await sessionUserFromRequest(request);
    const resultado = await validarConvite(id, conviteId, user ? { id: user.id, name: user.name } : null);
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/** Desfaz a validação (volta para "Concluiu"). */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id, conviteId } = await context.params;
    if (!UUID_REGEX.test(id) || !UUID_REGEX.test(conviteId)) {
      return NextResponse.json({ error: "Convite não encontrado." }, { status: 404 });
    }
    const resultado = await desfazerValidacao(id, conviteId);
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
