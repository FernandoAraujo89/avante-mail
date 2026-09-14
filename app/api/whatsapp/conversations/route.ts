import { NextRequest, NextResponse } from "next/server";

import { errorMessage } from "@/lib/utils";
import { listConversations } from "@/lib/whatsapp/conversations";

export const dynamic = "force-dynamic";

// Lista da caixa de conversas, da mais recente para a mais antiga.
// ?q= busca por nome, empresa, nome do perfil ou telefone; ?unread=1 só as
// que têm mensagem por ler.
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const conversations = await listConversations({
      search: params.get("q") ?? undefined,
      unreadOnly: params.get("unread") === "1",
    });
    return NextResponse.json({ conversations });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
