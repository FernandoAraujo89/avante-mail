import { NextRequest, NextResponse } from "next/server";

import { tokenBemFormado } from "@/lib/pesquisas/convites";
import { concluirConvite } from "@/lib/pesquisas/resposta-publica";
import { clientIp, rateLimitAllow } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };

// Rota PÚBLICA: o parceiro concluiu. Exige as obrigatórias e trava a edição.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    if (!tokenBemFormado(token)) {
      return NextResponse.json({ error: "Link inválido." }, { status: 404 });
    }
    const permitido = await rateLimitAllow(
      `pesquisa-concluir:${clientIp(request)}`,
      30,
      60,
      true
    );
    if (!permitido) {
      return NextResponse.json({ error: "Aguarde um instante e tente de novo." }, { status: 429 });
    }
    const resultado = await concluirConvite(token);
    if (!resultado.ok) {
      return NextResponse.json(
        { error: resultado.error, faltam: resultado.faltam ?? [] },
        { status: resultado.status }
      );
    }
    return NextResponse.json({ ok: true, thanks: resultado.thanks });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
