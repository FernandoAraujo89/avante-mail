import { NextRequest, NextResponse } from "next/server";

import { sessionUserFromRequest } from "@/lib/session";
import { errorMessage } from "@/lib/utils";
import { listConversations } from "@/lib/whatsapp/conversations";
import { linhasPedidas } from "@/lib/whatsapp/linhas";

export const dynamic = "force-dynamic";

// Lista da caixa de conversas, da mais recente para a mais antiga.
// ?q= busca por nome, empresa, nome do perfil ou telefone; ?unread=1 só as
// que têm mensagem por ler; ?linha= uma das linhas do perfil (sem ela, todas).
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const user = await sessionUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
    const conversations = await listConversations({
      search: params.get("q") ?? undefined,
      unreadOnly: params.get("unread") === "1",
      linhas: linhasPedidas(user.role, params.get("linha")),
    });
    return NextResponse.json({ conversations });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
