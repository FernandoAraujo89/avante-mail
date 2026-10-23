import { NextRequest, NextResponse } from "next/server";

import { ehPasso, listarPassos, registrarPasso } from "@/lib/pesquisas/mapeamento-db";
import { sessionUserFromRequest } from "@/lib/session";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; conviteId: string }> };

/** Os passos da régua já registrados neste convite, do mais recente ao mais antigo. */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id, conviteId } = await context.params;
    if (!UUID_REGEX.test(id) || !UUID_REGEX.test(conviteId)) {
      return NextResponse.json({ error: "Convite não encontrado." }, { status: 404 });
    }
    return NextResponse.json(await listarPassos(conviteId));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/** { kind, note? } — registra um passo; "sem_resposta" encerra o convite. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id, conviteId } = await context.params;
    if (!UUID_REGEX.test(id) || !UUID_REGEX.test(conviteId)) {
      return NextResponse.json({ error: "Convite não encontrado." }, { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as { kind?: unknown; note?: unknown };
    if (!ehPasso(body.kind)) {
      return NextResponse.json({ error: "Passo inválido." }, { status: 400 });
    }
    const user = await sessionUserFromRequest(request);
    const resultado = await registrarPasso({
      surveyId: id,
      inviteId: conviteId,
      kind: body.kind,
      note: typeof body.note === "string" ? body.note : null,
      autor: user ? { id: user.id, name: user.name } : null,
    });
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
