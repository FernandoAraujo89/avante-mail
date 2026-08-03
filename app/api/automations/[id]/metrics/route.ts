import { NextRequest, NextResponse } from "next/server";

import { relatorioDaAutomacao } from "@/lib/automations/relatorio";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Números por passo para a tela de edição: quantos contatos estão parados em
 * cada ponto e o que já foi enviado. É o mesmo relatório da fase 5, servido em
 * JSON porque o editor é client component.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const relatorio = await relatorioDaAutomacao(id);
    if (!relatorio) {
      return NextResponse.json(
        { error: "Automação não encontrada." },
        { status: 404 }
      );
    }
    return NextResponse.json({
      resumo: relatorio.resumo,
      passos: relatorio.passos.map((p) => ({
        stepId: p.stepId,
        agora: p.agora,
        passaram: p.passaram,
        envios: p.envios,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
