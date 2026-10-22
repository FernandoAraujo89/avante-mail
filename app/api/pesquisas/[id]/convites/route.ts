import { NextRequest, NextResponse } from "next/server";

import { carregarPesquisa } from "@/lib/pesquisas";
import {
  convidarParceiros,
  lerCanais,
  listarConvites,
} from "@/lib/pesquisas/envios";
import { sessionUserFromRequest } from "@/lib/session";
import { errorMessage, normalizeIds, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
    }
    return NextResponse.json(await listarConvites(id));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

// Convida parceiros (por lista e/ou avulsos) e manda o convite pelos canais
// marcados. Sem canal, só cria o link — para copiar e mandar à mão.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const pesquisa = UUID_REGEX.test(id) ? await carregarPesquisa(id) : null;
    if (!pesquisa) {
      return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
    }
    if (pesquisa.status !== "active") {
      return NextResponse.json(
        { error: "Ative a pesquisa antes de convidar parceiros." },
        { status: 400 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const contactIds = normalizeIds(
      body.contactIds ?? (typeof body.contactId === "string" ? [body.contactId] : [])
    );
    const listIds = normalizeIds(body.listIds);
    if (contactIds.length === 0 && listIds.length === 0) {
      return NextResponse.json(
        { error: "Escolha pelo menos uma lista ou um parceiro." },
        { status: 400 }
      );
    }
    const canais = lerCanais(body.channels);
    if (!canais.ok) return NextResponse.json({ error: canais.error }, { status: 400 });

    const user = await sessionUserFromRequest(request);
    const resultado = await convidarParceiros({
      surveyId: id,
      contactIds,
      listIds,
      canais: canais.canais,
      autor: user ? { id: user.id, name: user.name } : null,
    });
    return NextResponse.json(resultado, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
