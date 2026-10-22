import { NextRequest, NextResponse } from "next/server";

import { csvFilename, toCsv } from "@/lib/csv";
import { linhasCsv } from "@/lib/pesquisas/relatorio";
import {
  carregarRelatorio,
  dadosBrutosDoRelatorio,
  type FiltrosDoRelatorio,
} from "@/lib/pesquisas/relatorio-db";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function data(valor: string | null, fimDoDia: boolean): Date | null {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  // Datas do filtro em Brasília: "de" começa à meia-noite, "até" fecha o dia.
  const d = new Date(`${valor}T${fimDoDia ? "23:59:59.999" : "00:00:00.000"}-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ?lista=&de=AAAA-MM-DD&ate=AAAA-MM-DD&formato=csv */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
    }
    const p = request.nextUrl.searchParams;
    const lista = p.get("lista");
    const filtros: FiltrosDoRelatorio = {
      listId: lista && UUID_REGEX.test(lista) ? lista : null,
      de: data(p.get("de"), false),
      ate: data(p.get("ate"), true),
    };

    if (p.get("formato") === "csv") {
      const dados = await dadosBrutosDoRelatorio(id, filtros);
      if (!dados) {
        return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
      }
      const { headers, rows } = linhasCsv(dados.perguntas, dados.respostas, dados.convites);
      return new NextResponse(toCsv(headers, rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${csvFilename("pesquisa", dados.pesquisa.name)}"`,
        },
      });
    }

    const relatorio = await carregarRelatorio(id, filtros);
    if (!relatorio) {
      return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
    }
    return NextResponse.json(relatorio);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
