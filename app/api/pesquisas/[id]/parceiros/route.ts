import { NextRequest, NextResponse } from "next/server";

import { buscarParceiros } from "@/lib/pesquisas/envios";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** ?q=&lista= — parceiros para escolher um a um no convite desta pesquisa. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
    }
    const p = request.nextUrl.searchParams;
    const lista = p.get("lista");
    return NextResponse.json(
      await buscarParceiros({
        surveyId: id,
        q: p.get("q") ?? "",
        listId: lista && UUID_REGEX.test(lista) ? lista : null,
      })
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
