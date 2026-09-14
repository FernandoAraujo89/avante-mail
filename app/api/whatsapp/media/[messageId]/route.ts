import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, whatsappMessages } from "@/lib/db";
import { errorMessage, UUID_REGEX } from "@/lib/utils";
import {
  downloadInboundMedia,
  isWhatsAppConfigured,
} from "@/lib/whatsapp/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ messageId: string }> };

/**
 * Foto, áudio, vídeo ou documento que o contato mandou. O arquivo fica na
 * Meta e só sai com o token — por isso passa por aqui, atrás do login, em vez
 * de ir para /uploads (que é público: o conteúdo de um contato não pode ficar
 * a um link de qualquer um).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { messageId } = await context.params;
    const [message] = UUID_REGEX.test(messageId)
      ? await getDb()
          .select({
            mediaId: whatsappMessages.mediaId,
            mediaMimeType: whatsappMessages.mediaMimeType,
            mediaFilename: whatsappMessages.mediaFilename,
          })
          .from(whatsappMessages)
          .where(eq(whatsappMessages.id, messageId))
      : [];
    if (!message?.mediaId) {
      return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });
    }
    if (!isWhatsAppConfigured()) {
      return NextResponse.json(
        { error: "Canal WhatsApp não configurado neste servidor." },
        { status: 503 }
      );
    }

    const media = await downloadInboundMedia(message.mediaId);
    const headers = new Headers({
      "Content-Type":
        media.mimeType ?? message.mediaMimeType ?? "application/octet-stream",
      // O arquivo não muda; guardar no navegador poupa ida à Meta a cada abertura.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    });
    if (message.mediaFilename) {
      headers.set(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(message.mediaFilename)}`
      );
    }
    return new NextResponse(media.body, { headers });
  } catch (error) {
    // A Meta guarda a mídia recebida por tempo limitado; depois disso o id
    // não resolve mais.
    return NextResponse.json(
      { error: `Não foi possível buscar a mídia na Meta: ${errorMessage(error)}` },
      { status: 502 }
    );
  }
}
