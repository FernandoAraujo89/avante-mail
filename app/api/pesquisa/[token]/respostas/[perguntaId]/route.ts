import { NextRequest, NextResponse } from "next/server";

import { tokenBemFormado } from "@/lib/pesquisas/convites";
import { gravarResposta } from "@/lib/pesquisas/resposta-publica";
import { clientIp, rateLimitAllow } from "@/lib/rate-limit";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string; perguntaId: string }> };

// Rota PÚBLICA (o token é a credencial): grava a resposta de uma pergunta.
// Limite por IP fechado: estourar é alguém martelando, não um parceiro.
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { token, perguntaId } = await context.params;
    if (!tokenBemFormado(token) || !UUID_REGEX.test(perguntaId)) {
      return NextResponse.json({ error: "Link inválido." }, { status: 404 });
    }
    const permitido = await rateLimitAllow(
      `pesquisa-resposta:${clientIp(request)}`,
      240,
      60,
      true
    );
    if (!permitido) {
      return NextResponse.json(
        { error: "Muitas respostas em sequência. Aguarde um instante." },
        { status: 429 }
      );
    }
    const body = (await request.json().catch(() => ({}))) as { valor?: unknown };
    const resultado = await gravarResposta(token, perguntaId, body.valor);
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: resultado.status });
    }
    return NextResponse.json({ ok: true, valor: resultado.valor });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
