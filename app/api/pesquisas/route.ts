import { NextRequest, NextResponse } from "next/server";

import { criarPesquisa, listarPesquisas } from "@/lib/pesquisas";
import { ehObjetivo, parsePesquisa } from "@/lib/pesquisas/perguntas";
import { sessionUserFromRequest } from "@/lib/session";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listarPesquisas());
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!ehObjetivo(body.objective)) {
      return NextResponse.json(
        { error: "Escolha o objetivo da pesquisa." },
        { status: 400 }
      );
    }
    const parsed = parsePesquisa(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const user = await sessionUserFromRequest(request);
    const id = await criarPesquisa({
      objective: body.objective,
      ...parsed.dados,
      autor: user ? { id: user.id, name: user.name } : null,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
