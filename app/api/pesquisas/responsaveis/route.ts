import { NextResponse } from "next/server";

import { listarResponsaveis } from "@/lib/pesquisas/mapeamento-db";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Quem pode ser o responsável por um parceiro: a Expansão e o admin. */
export async function GET() {
  try {
    return NextResponse.json(await listarResponsaveis());
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
