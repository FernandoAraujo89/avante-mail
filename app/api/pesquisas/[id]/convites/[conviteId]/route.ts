import { NextRequest, NextResponse } from "next/server";

import { encerrarConvite, excluirConvite, reabrirConvite } from "@/lib/pesquisas/envios";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; conviteId: string }> };

/** { acao: "encerrar" | "reabrir" } */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id, conviteId } = await context.params;
    if (!UUID_REGEX.test(id) || !UUID_REGEX.test(conviteId)) {
      return NextResponse.json({ error: "Convite não encontrado." }, { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as { acao?: unknown };
    const resultado =
      body.acao === "encerrar"
        ? await encerrarConvite(id, conviteId)
        : body.acao === "reabrir"
          ? await reabrirConvite(id, conviteId)
          : { ok: false as const, error: "Ação inválida." };
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/**
 * Apaga o convite. Sem respostas, direto; com respostas, só com
 * `?respostas=apagar` (a tela pede confirmação antes).
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id, conviteId } = await context.params;
    if (!UUID_REGEX.test(id) || !UUID_REGEX.test(conviteId)) {
      return NextResponse.json({ error: "Convite não encontrado." }, { status: 404 });
    }
    const comRespostas = request.nextUrl.searchParams.get("respostas") === "apagar";
    const resultado = await excluirConvite(id, conviteId, { comRespostas });
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: 409 });
    }
    return NextResponse.json({ ok: true, respostas: resultado.respostas });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
