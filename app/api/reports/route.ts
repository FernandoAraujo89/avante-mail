import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, isNotNull, lte } from "drizzle-orm";

import { campaigns, campaignSends, getDb } from "@/lib/db";
import { aggregateReport, parsePeriod, type SendRow } from "@/lib/reports";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(now);
  const past = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  const from = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(past);
  return { from, to };
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const fallback = defaultRange();
    const from = params.get("from") ?? fallback.from;
    const to = params.get("to") ?? fallback.to;

    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return NextResponse.json(
        { error: "Datas inválidas. Use o formato AAAA-MM-DD." },
        { status: 400 }
      );
    }
    if (from > to) {
      return NextResponse.json(
        { error: "A data inicial não pode ser maior que a final." },
        { status: 400 }
      );
    }

    const campaignFilterRaw = params.get("campaignIds")?.trim();
    const campaignFilter = campaignFilterRaw
      ? new Set(campaignFilterRaw.split(",").filter(Boolean))
      : undefined;

    const period = parsePeriod(from, to);
    const db = getDb();

    // Envios do período atual + anterior (só os que foram efetivamente
    // enviados — sentAt preenchido, o que inclui os que depois bounceram).
    const rows = await db
      .select({
        campaignId: campaignSends.campaignId,
        campaignName: campaigns.name,
        sentAt: campaignSends.sentAt,
        openedAt: campaignSends.openedAt,
        clickedAt: campaignSends.clickedAt,
        bouncedAt: campaignSends.bouncedAt,
        complainedAt: campaignSends.complainedAt,
        unsubscribedAt: campaignSends.unsubscribedAt,
      })
      .from(campaignSends)
      .innerJoin(campaigns, eq(campaignSends.campaignId, campaigns.id))
      .where(
        and(
          isNotNull(campaignSends.sentAt),
          gte(campaignSends.sentAt, period.prevFromDate),
          lte(campaignSends.sentAt, period.toDate)
        )
      );

    const sendRows: SendRow[] = rows.map((r) => ({
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      sentAt: r.sentAt as Date,
      openedAt: r.openedAt,
      clickedAt: r.clickedAt,
      bouncedAt: r.bouncedAt,
      complainedAt: r.complainedAt,
      unsubscribedAt: r.unsubscribedAt,
    }));

    const result = aggregateReport(
      sendRows,
      period,
      from,
      to,
      new Date().toISOString(),
      campaignFilter
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
