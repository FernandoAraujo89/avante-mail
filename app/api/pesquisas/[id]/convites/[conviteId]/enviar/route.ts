import { NextRequest, NextResponse } from "next/server";

import { carregarPesquisa } from "@/lib/pesquisas";
import { lerCanais, reenviarConvite } from "@/lib/pesquisas/envios";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; conviteId: string }> };

/** Reenvia o convite de um parceiro: { channels: ["email" | "whatsapp"] }. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id, conviteId } = await context.params;
    if (!UUID_REGEX.test(id) || !UUID_REGEX.test(conviteId)) {
      return NextResponse.json({ error: "Convite não encontrado." }, { status: 404 });
    }
    const pesquisa = await carregarPesquisa(id);
    if (!pesquisa) {
      return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
    }
    if (pesquisa.status !== "active") {
      return NextResponse.json({ error: "A pesquisa não está ativa." }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const canais = lerCanais(body.channels);
    if (!canais.ok) return NextResponse.json({ error: canais.error }, { status: 400 });
    if (canais.canais.length === 0) {
      return NextResponse.json({ error: "Escolha por onde reenviar." }, { status: 400 });
    }
    if (canais.canais.includes("whatsapp") && !pesquisa.whatsapp.pronto) {
      return NextResponse.json({ error: pesquisa.whatsapp.motivo }, { status: 400 });
    }
    const resultado = await reenviarConvite({ surveyId: id, inviteId: conviteId, canais: canais.canais });
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: 400 });
    }
    return NextResponse.json(resultado);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
