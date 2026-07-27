import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { campaigns, campaignSends, contacts, getDb } from "@/lib/db";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
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

    const sends = await db
      .select({
        id: campaignSends.id,
        status: campaignSends.status,
        sentAt: campaignSends.sentAt,
        openedAt: campaignSends.openedAt,
        clickedAt: campaignSends.clickedAt,
        deliveredAt: campaignSends.deliveredAt,
        readAt: campaignSends.readAt,
        repliedAt: campaignSends.repliedAt,
        errorCode: campaignSends.errorCode,
        contactName: contacts.name,
        contactEmail: contacts.email,
        contactPhone: contacts.phone,
        contactCompany: contacts.company,
      })
      .from(campaignSends)
      .innerJoin(contacts, eq(campaignSends.contactId, contacts.id))
      .where(eq(campaignSends.campaignId, id))
      .orderBy(asc(contacts.name));

    const pending = sends.filter((s) => s.status === "pending").length;
    const failed = sends.filter((s) => s.status === "failed").length;

    const metrics =
      campaign.channel === "whatsapp"
        ? {
            total: sends.length,
            // "Enviada" = deixou o sistema com sucesso (qualquer estágio).
            sent: sends.filter((s) =>
              ["sent", "delivered", "read"].includes(s.status)
            ).length,
            delivered: sends.filter(
              (s) => s.deliveredAt !== null || s.status === "read"
            ).length,
            read: sends.filter((s) => s.readAt !== null).length,
            replied: sends.filter((s) => s.repliedAt !== null).length,
            failed,
            // 131049 = limite de marketing do destinatário (esperado; não é
            // erro técnico). Destacado à parte no relatório.
            frequencyCapped: sends.filter((s) => s.errorCode === "131049")
              .length,
            pending,
          }
        : {
            total: sends.length,
            sent: sends.filter((s) =>
              ["sent", "opened", "clicked"].includes(s.status)
            ).length,
            opened: sends.filter((s) => s.openedAt !== null).length,
            clicked: sends.filter((s) => s.clickedAt !== null).length,
            failed,
            pending,
          };

    return NextResponse.json({ campaign, metrics, sends });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
