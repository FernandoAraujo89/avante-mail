import { NextRequest, NextResponse } from "next/server";

import {
  lerEmailsDeAcompanhamento,
  lerLideres,
  salvarLideres,
} from "@/lib/acompanhamento";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

// A lista de quem recebe a cópia de acompanhamento de toda campanha
// (lib/acompanhamento). Só administradores chegam aqui: o middleware fecha
// /api/campaigns para o Sucesso do cliente.

export async function GET() {
  try {
    return NextResponse.json({ emails: await lerLideres() });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { emails, invalidos } = lerEmailsDeAcompanhamento(body.emails);
    // Um e-mail com erro de digitação some sem aviso se for só descartado: a
    // pessoa acha que está recebendo e não está. Melhor recusar e apontar.
    if (invalidos.length > 0) {
      return NextResponse.json(
        {
          error: `Não ${invalidos.length === 1 ? "é um e-mail válido" : "são e-mails válidos"}: ${invalidos.join(", ")}`,
          invalidos,
        },
        { status: 400 }
      );
    }
    await salvarLideres(emails);
    return NextResponse.json({ emails });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
