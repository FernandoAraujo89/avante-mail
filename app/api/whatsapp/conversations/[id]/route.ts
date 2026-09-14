import { NextRequest, NextResponse } from "next/server";

import { errorMessage, UUID_REGEX } from "@/lib/utils";
import { loadConversationThread } from "@/lib/whatsapp/conversations";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Uma conversa inteira: as mensagens gravadas, os modelos que o contato
// recebeu por campanha/automação e o estado da janela de 24h.
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const thread = UUID_REGEX.test(id) ? await loadConversationThread(id) : null;
    if (!thread) {
      return NextResponse.json(
        { error: "Conversa não encontrada." },
        { status: 404 }
      );
    }
    return NextResponse.json(thread);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
