import { NextRequest, NextResponse } from "next/server";

import { frentesDoParceiro } from "@/lib/pesquisas/relatorio-db";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ contactId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { contactId } = await context.params;
    const parceiro = UUID_REGEX.test(contactId) ? await frentesDoParceiro(contactId) : null;
    if (!parceiro) {
      return NextResponse.json({ error: "Parceiro não encontrado." }, { status: 404 });
    }
    return NextResponse.json(parceiro);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
