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
        contactName: contacts.name,
        contactEmail: contacts.email,
        contactCompany: contacts.company,
      })
      .from(campaignSends)
      .innerJoin(contacts, eq(campaignSends.contactId, contacts.id))
      .where(eq(campaignSends.campaignId, id))
      .orderBy(asc(contacts.name));

    const metrics = {
      total: sends.length,
      sent: sends.filter((s) =>
        ["sent", "opened", "clicked"].includes(s.status)
      ).length,
      opened: sends.filter((s) => s.openedAt !== null).length,
      clicked: sends.filter((s) => s.clickedAt !== null).length,
      failed: sends.filter((s) => s.status === "failed").length,
      pending: sends.filter((s) => s.status === "pending").length,
    };

    return NextResponse.json({ campaign, metrics, sends });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
