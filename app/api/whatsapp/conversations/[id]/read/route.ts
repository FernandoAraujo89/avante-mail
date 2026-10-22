import { NextRequest, NextResponse } from "next/server";

import { errorMessage, UUID_REGEX } from "@/lib/utils";
import { isLinhaConfigurada, markMessageAsRead } from "@/lib/whatsapp/client";
import { markConversationRead } from "@/lib/whatsapp/conversations";
import { conversaAlcancavel } from "@/lib/whatsapp/linhas-acesso";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Alguém da equipe abriu a conversa: zera as não lidas e manda a confirmação
// de leitura (os tiques azuis) para o contato.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const conversation = UUID_REGEX.test(id) ? await conversaAlcancavel(request, id) : null;
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversa não encontrada." },
        { status: 404 }
      );
    }

    const { lastInboundWamid } = await markConversationRead(id);

    // Best-effort: sem os tiques a conversa continua funcionando.
    if (lastInboundWamid && isLinhaConfigurada(conversation.line)) {
      try {
        await markMessageAsRead(lastInboundWamid, conversation.line);
      } catch (error) {
        console.error(
          "[WHATSAPP] Falha ao confirmar leitura na Meta:",
          errorMessage(error)
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
