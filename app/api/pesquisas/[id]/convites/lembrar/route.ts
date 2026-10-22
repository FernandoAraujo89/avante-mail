import { NextRequest, NextResponse } from "next/server";

import { carregarPesquisa } from "@/lib/pesquisas";
import {
  lembrarParceiros,
  lerCanais,
  limitesDeLembrete,
} from "@/lib/pesquisas/envios";
import { errorMessage, normalizeIds, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Os limites em vigor, para a tela avisar antes. */
export async function GET() {
  try {
    return NextResponse.json(await limitesDeLembrete());
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

// Lembra os convites escolhidos ou todos os pendentes — manual e em lote
// (decisão 5 do plano), dentro do teto e do intervalo configurados.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const pesquisa = UUID_REGEX.test(id) ? await carregarPesquisa(id) : null;
    if (!pesquisa) {
      return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
    }
    if (pesquisa.status !== "active") {
      return NextResponse.json(
        { error: "A pesquisa não está ativa — não há o que lembrar." },
        { status: 400 }
      );
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const inviteIds = body.todosPendentes === true ? "pendentes" : normalizeIds(body.inviteIds);
    if (inviteIds !== "pendentes" && inviteIds.length === 0) {
      return NextResponse.json({ error: "Escolha quem lembrar." }, { status: 400 });
    }
    const canais = lerCanais(body.channels);
    if (!canais.ok) return NextResponse.json({ error: canais.error }, { status: 400 });
    if (canais.canais.length === 0) {
      return NextResponse.json({ error: "Escolha por onde lembrar." }, { status: 400 });
    }
    if (canais.canais.includes("whatsapp") && !pesquisa.whatsapp.pronto) {
      return NextResponse.json({ error: pesquisa.whatsapp.motivo }, { status: 400 });
    }
    const resultado = await lembrarParceiros({ surveyId: id, inviteIds, canais: canais.canais });
    return NextResponse.json(resultado);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
