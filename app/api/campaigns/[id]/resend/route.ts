import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { campaigns, campaignSends, contacts, getDb } from "@/lib/db";
import { getWhatsAppQueue } from "@/lib/queue";
import { errorMessage } from "@/lib/utils";
import { isWhatsAppConfigured } from "@/lib/whatsapp/client";
import { RESENDABLE_ERROR_CODES } from "@/lib/whatsapp/errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Reenvio dos envios que a Meta segurou por frequência/vazão — o caso comum é
// o 131049 (teto de marketing por destinatário). Falhas de configuração, de
// modelo ou de número inválido ficam de fora: reenviar sem corrigir a causa
// daria exatamente no mesmo, e ainda contaria como nova tentativa.
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, id));

    if (!campaign) {
      return NextResponse.json(
        { error: "Campanha não encontrada." },
        { status: 404 }
      );
    }
    if (campaign.channel !== "whatsapp") {
      return NextResponse.json(
        { error: "O reenvio por limite vale só para campanhas de WhatsApp." },
        { status: 400 }
      );
    }
    if (!isWhatsAppConfigured()) {
      return NextResponse.json(
        { error: "Canal WhatsApp não configurado no servidor." },
        { status: 400 }
      );
    }

    // Só reenvia para quem CONTINUA elegível: se o contato pediu para sair
    // (respondeu SAIR) ou perdeu o telefone depois do disparo, ele não volta
    // para a fila — a mesma regra do envio original.
    const alvos = await db
      .select({
        id: campaignSends.id,
        contactId: campaignSends.contactId,
      })
      .from(campaignSends)
      .innerJoin(contacts, eq(contacts.id, campaignSends.contactId))
      .where(
        and(
          eq(campaignSends.campaignId, campaign.id),
          eq(campaignSends.status, "failed"),
          inArray(campaignSends.errorCode, RESENDABLE_ERROR_CODES),
          eq(contacts.whatsappSubscribed, true),
          isNotNull(contacts.phone)
        )
      );

    if (alvos.length === 0) {
      return NextResponse.json(
        {
          error:
            "Nenhum envio para reenviar: só entram os que a Meta segurou por limite e cujo contato ainda aceita WhatsApp.",
        },
        { status: 400 }
      );
    }

    // Zera a tentativa anterior — a linha volta para "na fila" e o relatório
    // passa a mostrar o resultado novo, não o antigo.
    await db
      .update(campaignSends)
      .set({
        status: "pending",
        errorCode: null,
        errorMessage: null,
        sentAt: null,
        providerMessageId: null,
      })
      .where(
        inArray(
          campaignSends.id,
          alvos.map((a) => a.id)
        )
      );

    const queue = getWhatsAppQueue();
    await queue.addBulk(
      alvos.map((alvo) => ({
        name: "send-whatsapp",
        data: {
          sendId: alvo.id,
          campaignId: campaign.id,
          contactId: alvo.contactId,
        },
        opts: {
          attempts: 3,
          backoff: { type: "exponential" as const, delay: 3000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      }))
    );

    await db
      .update(campaigns)
      .set({ status: "sending" })
      .where(eq(campaigns.id, campaign.id));

    return NextResponse.json({ queued: alvos.length });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
