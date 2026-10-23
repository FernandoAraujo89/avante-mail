import { NextRequest, NextResponse } from "next/server";

import { duplicarPesquisa } from "@/lib/pesquisas";
import { sessionUserFromRequest } from "@/lib/session";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Uma cópia em rascunho da pesquisa (perguntas e mensagens), para editar. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
    }
    const user = await sessionUserFromRequest(request);
    const novoId = await duplicarPesquisa(id, user ? { id: user.id, name: user.name } : null);
    if (!novoId) {
      return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ id: novoId }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
