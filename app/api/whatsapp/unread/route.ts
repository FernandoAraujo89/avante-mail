import { NextRequest, NextResponse } from "next/server";

import { errorMessage } from "@/lib/utils";
import { countUnreadConversations } from "@/lib/whatsapp/conversations";
import { caixasDaRequisicao } from "@/lib/whatsapp/linhas-acesso";

export const dynamic = "force-dynamic";

// Conversas com mensagem por ler — o número ao lado de "Conversas" no menu.
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({
      unread: await countUnreadConversations(await caixasDaRequisicao(request)),
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
