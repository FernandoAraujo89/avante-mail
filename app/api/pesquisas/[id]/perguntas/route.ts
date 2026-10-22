import { NextRequest, NextResponse } from "next/server";

import {
  carregarPesquisa,
  perguntasExistentes,
  salvarPerguntas,
} from "@/lib/pesquisas";
import { diffPerguntas, parsePerguntas } from "@/lib/pesquisas/perguntas";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// A lista inteira do construtor, na ordem final. O que saiu e já tinha
// resposta fica arquivado; o que saiu sem resposta vai embora.
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const pesquisa = UUID_REGEX.test(id) ? await carregarPesquisa(id) : null;
    if (!pesquisa) {
      return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
    }

    const parsed = parsePerguntas(await request.json().catch(() => ({})));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const diff = diffPerguntas(await perguntasExistentes(id), parsed.perguntas);
    if (!diff.ok) {
      return NextResponse.json({ error: diff.error }, { status: 400 });
    }
    await salvarPerguntas(id, diff.diff);
    return NextResponse.json(await carregarPesquisa(id));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
