import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";

import { campaigns, campaignSends, getDb } from "@/lib/db";
import {
  aggregateReport,
  aggregateWhatsAppReport,
  parsePeriod,
  type SendRow,
  type WaCampaignRef,
  type WaSendRow,
} from "@/lib/reports";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Escopos do relatório. Os dados dos três nunca se misturam:
//  - campaigns: campanhas de e-mail (kind = campaign, canal e-mail);
//  - news: edições do Avante News (kind = news, sempre e-mail);
//  - whatsapp: campanhas de WhatsApp (métricas próprias do canal).
const SCOPES = ["campaigns", "news", "whatsapp"] as const;
type Scope = (typeof SCOPES)[number];

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

    const scopeParam = params.get("scope") ?? "campaigns";
    if (!SCOPES.includes(scopeParam as Scope)) {
      return NextResponse.json(
        { error: "Escopo inválido. Use campaigns, news ou whatsapp." },
        { status: 400 }
      );
    }
    const scope = scopeParam as Scope;

    const campaignFilterRaw = params.get("campaignIds")?.trim();
    const campaignFilter = campaignFilterRaw
      ? new Set(campaignFilterRaw.split(",").filter(Boolean))
      : undefined;

    const period = parsePeriod(from, to);
    const db = getDb();
    const generatedAt = new Date().toISOString();

    if (scope === "whatsapp") {
      // A campanha entra pela data de referência (envio, agendamento ou
      // criação) — um disparo que só falhou não tem envio com data e ainda
      // assim precisa aparecer no período.
      const reference = sql<Date>`coalesce(${campaigns.sentAt}, ${campaigns.scheduledAt}, ${campaigns.createdAt})`;

      const refRows = await db
        .select({
          id: campaigns.id,
          name: campaigns.name,
          sendDate: reference,
        })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.channel, "whatsapp"),
            inArray(campaigns.status, ["sending", "sent"]),
            gte(reference, period.prevFromDate),
            lte(reference, period.toDate)
          )
        );

      const refs: WaCampaignRef[] = refRows.map((r) => ({
        id: r.id,
        name: r.name,
        sendDate: new Date(r.sendDate),
      }));

      const sends =
        refs.length === 0
          ? []
          : await db
              .select({
                campaignId: campaignSends.campaignId,
                status: campaignSends.status,
                sentAt: campaignSends.sentAt,
                deliveredAt: campaignSends.deliveredAt,
                readAt: campaignSends.readAt,
                repliedAt: campaignSends.repliedAt,
                errorCode: campaignSends.errorCode,
              })
              .from(campaignSends)
              .where(
                inArray(
                  campaignSends.campaignId,
                  refs.map((r) => r.id)
                )
              );

      return NextResponse.json(
        aggregateWhatsAppReport(
          refs,
          sends as WaSendRow[],
          period,
          from,
          to,
          generatedAt,
          campaignFilter
        )
      );
    }

    // ─── Canais de e-mail (campanhas e Avante News) ────────────────────
    // Envios do período atual + anterior (só os efetivamente enviados —
    // sentAt preenchido, o que inclui os que depois devolveram).
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
          // Só e-mail: envios de WhatsApp não têm abertura/clique e
          // distorceriam as taxas deste painel (têm escopo próprio).
          eq(campaigns.channel, "email"),
          scope === "news"
            ? eq(campaigns.kind, "news")
            : // Campanhas antigas (anteriores ao Avante News) podem não ter
              // kind preenchido — contam como campanha.
              or(eq(campaigns.kind, "campaign"), sql`${campaigns.kind} is null`),
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
      generatedAt,
      campaignFilter
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
