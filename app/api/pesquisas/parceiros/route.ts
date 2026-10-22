import { NextRequest, NextResponse } from "next/server";

import { painelDeParceiros } from "@/lib/pesquisas/relatorio-db";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

// O painel das 3 frentes: cada parceiro e o convite mais recente em cada
// pesquisa. Leitura também para o Sucesso do cliente (decisão 4 do plano).
export async function GET(request: NextRequest) {
  try {
    const lista = request.nextUrl.searchParams.get("lista");
    return NextResponse.json(
      await painelDeParceiros(lista && UUID_REGEX.test(lista) ? lista : null)
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
