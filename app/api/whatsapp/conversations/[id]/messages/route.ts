import { NextRequest, NextResponse } from "next/server";

import { sessionUserFromRequest } from "@/lib/session";
import { errorMessage, UUID_REGEX } from "@/lib/utils";
import { isLinhaConfigurada } from "@/lib/whatsapp/client";
import { sendTextInConversation } from "@/lib/whatsapp/conversations";
import { LINHA_LABEL } from "@/lib/whatsapp/linhas";
import { conversaAlcancavel } from "@/lib/whatsapp/linhas-acesso";
import { serviceWindow, WHATSAPP_TEXT_MAX } from "@/lib/whatsapp/inbound";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Resposta da equipe na conversa: texto livre, só dentro da janela de 24h
// aberta pela última mensagem do contato (regra da Meta). A resposta é
// gratuita — conversa de atendimento não é cobrada.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) {
      return NextResponse.json(
        { error: "Escreva a mensagem antes de enviar." },
        { status: 400 }
      );
    }
    if (text.length > WHATSAPP_TEXT_MAX) {
      return NextResponse.json(
        {
          error: `A mensagem pode ter no máximo ${WHATSAPP_TEXT_MAX} caracteres (tem ${text.length}).`,
        },
        { status: 400 }
      );
    }

    const conversation = UUID_REGEX.test(id) ? await conversaAlcancavel(request, id) : null;
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversa não encontrada." },
        { status: 404 }
      );
    }

    if (!isLinhaConfigurada(conversation.line)) {
      return NextResponse.json(
        {
          error: `O número "${LINHA_LABEL[conversation.line]}" ainda não está configurado neste servidor — não há como enviar a resposta.`,
        },
        { status: 503 }
      );
    }

    if (!serviceWindow(conversation.lastInboundAt).open) {
      return NextResponse.json(
        {
          error:
            "A janela de 24h desta conversa fechou: o WhatsApp só aceita texto livre até 24 horas depois da última mensagem do contato. Para retomar, envie um modelo aprovado.",
        },
        { status: 409 }
      );
    }

    const user = await sessionUserFromRequest(request);
    const { message, error } = await sendTextInConversation({
      conversationId: conversation.id,
      linha: conversation.line,
      to: conversation.waId ?? conversation.phone.replace(/^\+/, ""),
      text,
      sentBy: { id: user?.id ?? null, name: user?.name || "Equipe" },
    });

    if (error) {
      return NextResponse.json(
        { error: `A Meta recusou a mensagem: ${error}`, message },
        { status: 502 }
      );
    }
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
