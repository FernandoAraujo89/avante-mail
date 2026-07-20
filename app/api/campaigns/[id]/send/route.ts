import { NextRequest, NextResponse } from "next/server";
import { and, arrayOverlaps, eq, inArray, type SQL } from "drizzle-orm";

import {
  campaigns,
  campaignSends,
  contacts,
  getDb,
  templates,
} from "@/lib/db";
import { getEmailQueue } from "@/lib/queue";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

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
    if (campaign.status === "sending" || campaign.status === "sent") {
      return NextResponse.json(
        { error: "Esta campanha já foi disparada." },
        { status: 409 }
      );
    }
    // O e-mail vem do design próprio da campanha (mjmlContent). Campanhas
    // antigas ainda podem depender do template de origem (fallback).
    if (!campaign.mjmlContent) {
      if (!campaign.templateId) {
        return NextResponse.json(
          { error: "Monte o e-mail da campanha antes de disparar." },
          { status: 400 }
        );
      }
      const [template] = await db
        .select({ id: templates.id })
        .from(templates)
        .where(eq(templates.id, campaign.templateId));

      if (!template) {
        return NextResponse.json(
          { error: "Esta campanha não tem e-mail montado e o template de origem não existe mais." },
          { status: 400 }
        );
      }
    }

    // 1. Contatos elegíveis: inscritos + segmentos + tags.
    const conditions: SQL[] = [eq(contacts.subscribed, true)];
    if (campaign.segments && campaign.segments.length > 0) {
      conditions.push(inArray(contacts.segment, campaign.segments));
    }
    if (campaign.tagsFilter && campaign.tagsFilter.length > 0) {
      conditions.push(arrayOverlaps(contacts.tags, campaign.tagsFilter));
    }

    const eligible = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(...conditions));

    if (eligible.length === 0) {
      return NextResponse.json(
        { error: "Nenhum destinatário elegível para os filtros da campanha." },
        { status: 400 }
      );
    }

    // 2. Um registro de envio por contato.
    const sends = await db
      .insert(campaignSends)
      .values(
        eligible.map((contact) => ({
          campaignId: campaign.id,
          contactId: contact.id,
        }))
      )
      .returning({
        id: campaignSends.id,
        contactId: campaignSends.contactId,
      });

    // 3. Enfileira no Redis. Agendamentos futuros viram jobs com delay.
    const delay = campaign.scheduledAt
      ? Math.max(campaign.scheduledAt.getTime() - Date.now(), 0)
      : 0;

    const queue = getEmailQueue();
    await queue.addBulk(
      sends.map((send) => ({
        name: "send-email",
        data: {
          sendId: send.id,
          campaignId: campaign.id,
          contactId: send.contactId,
        },
        opts: {
          delay,
          attempts: 3,
          backoff: { type: "exponential" as const, delay: 3000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      }))
    );

    // 4. Atualiza o status da campanha.
    await db
      .update(campaigns)
      .set({ status: delay > 0 ? "scheduled" : "sending" })
      .where(eq(campaigns.id, campaign.id));

    // 5. Resultado.
    return NextResponse.json({
      queued: sends.length,
      scheduled: delay > 0,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
