import { NextResponse } from "next/server";

import { indicadoresDoProjeto } from "@/lib/pesquisas/mapeamento-db";
import { painelDeParceiros } from "@/lib/pesquisas/relatorio-db";
import { SAUDES, type Saude } from "@/lib/pesquisas/mapeamento";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Os indicadores do projeto Mapeamento da Parceria, mais o mapa de saúde da base. */
export async function GET() {
  try {
    const [indicadores, painel] = await Promise.all([indicadoresDoProjeto(), painelDeParceiros(null)]);
    const saude = Object.fromEntries(SAUDES.map((s) => [s, 0])) as Record<Saude, number>;
    for (const linha of painel) saude[linha.saude] += 1;
    return NextResponse.json({ ...indicadores, saude, parceiros: painel.length });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
