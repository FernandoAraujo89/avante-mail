import { NextRequest, NextResponse } from "next/server";

import { listarAlertas, type EstadoDosAlertas } from "@/lib/pesquisas/mapeamento-db";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** ?estado=abertos|tratados|todos&contato=<id> — alertas de risco para a Expansão. */
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const estado = p.get("estado");
    const contato = p.get("contato");
    return NextResponse.json(
      await listarAlertas({
        estado: (["abertos", "tratados", "todos"] as const).includes(estado as EstadoDosAlertas)
          ? (estado as EstadoDosAlertas)
          : "abertos",
        contactId: contato && UUID_REGEX.test(contato) ? contato : null,
      })
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
