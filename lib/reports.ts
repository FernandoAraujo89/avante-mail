import { ratePct } from "./format";

// Fuso fixo do Brasil (sem horário de verão desde 2019): UTC−3.
const BR_OFFSET = "-03:00";

export interface SendRow {
  campaignId: string;
  campaignName: string;
  sentAt: Date;
  openedAt: Date | null;
  clickedAt: Date | null;
  bouncedAt: Date | null;
  complainedAt: Date | null;
  unsubscribedAt: Date | null;
}

export interface KpiCount {
  value: number;
  previous: number;
}

export interface KpiRate {
  value: number | null; // escala 0–100
  previous: number | null;
}

export interface ReportKpis {
  campaigns: KpiCount;
  sent: KpiCount;
  delivered: KpiCount;
  openRate: KpiRate & { opened: number; delivered: number };
  clickRate: KpiRate & { clicked: number; delivered: number };
  ctor: KpiRate;
  bounces: KpiCount & { rate: number | null; ratePrevious: number | null };
  complaints: KpiCount & { rate: number | null; ratePrevious: number | null };
  unsubscribes: KpiCount & { rate: number | null; ratePrevious: number | null };
}

export interface CampaignRow {
  id: string;
  name: string;
  sentAt: string;
  sent: number;
  delivered: number;
  openedUnique: number;
  openRate: number | null;
  clickedUnique: number;
  clickRate: number | null;
  bounces: number;
  bounceRate: number | null;
  complaints: number;
  complaintRate: number | null;
  unsubscribes: number;
}

export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  opened: number;
  clicked: number;
}

export interface ReportResult {
  generatedAt: string;
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  kpis: ReportKpis;
  campaigns: CampaignRow[];
  series: SeriesPoint[];
  seriesByCampaign: Record<string, SeriesPoint[]>;
}

export interface ParsedPeriod {
  fromDate: Date;
  toDate: Date;
  prevFromDate: Date;
  prevToDate: Date;
}

/** Interpreta from/to (YYYY-MM-DD) como dias inteiros no fuso do Brasil. */
export function parsePeriod(from: string, to: string): ParsedPeriod {
  const fromDate = new Date(`${from}T00:00:00.000${BR_OFFSET}`);
  const toDate = new Date(`${to}T23:59:59.999${BR_OFFSET}`);
  const span = toDate.getTime() - fromDate.getTime();
  const prevToDate = new Date(fromDate.getTime() - 1);
  const prevFromDate = new Date(fromDate.getTime() - span - 1);
  return { fromDate, toDate, prevFromDate, prevToDate };
}

/** Chave de dia (YYYY-MM-DD) no fuso do Brasil. */
export function dayKey(date: Date): string {
  // en-CA formata como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

/** Lista de dias (YYYY-MM-DD) de `from` até `to`, inclusive. */
export function dayRange(fromDate: Date, toDate: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(fromDate.getTime());
  // Passos de 24h são seguros: Brasil não tem horário de verão.
  while (cursor.getTime() <= toDate.getTime()) {
    days.push(dayKey(cursor));
    cursor.setUTCHours(cursor.getUTCHours() + 24);
  }
  return days;
}

interface CampaignBucket {
  id: string;
  name: string;
  sendDate: Date;
  rows: SendRow[];
}

function groupByCampaign(rows: SendRow[]): Map<string, CampaignBucket> {
  const map = new Map<string, CampaignBucket>();
  for (const row of rows) {
    let bucket = map.get(row.campaignId);
    if (!bucket) {
      bucket = {
        id: row.campaignId,
        name: row.campaignName,
        sendDate: row.sentAt,
        rows: [],
      };
      map.set(row.campaignId, bucket);
    }
    bucket.rows.push(row);
    if (row.sentAt < bucket.sendDate) bucket.sendDate = row.sentAt;
  }
  return map;
}

interface Totals {
  campaigns: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounces: number;
  complaints: number;
  unsubscribes: number;
}

function totalsFor(buckets: CampaignBucket[]): Totals {
  const t: Totals = {
    campaigns: buckets.length,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounces: 0,
    complaints: 0,
    unsubscribes: 0,
  };
  for (const b of buckets) {
    for (const r of b.rows) {
      t.sent += 1;
      if (r.bouncedAt) t.bounces += 1;
      else t.delivered += 1;
      if (r.openedAt) t.opened += 1;
      if (r.clickedAt) t.clicked += 1;
      if (r.complainedAt) t.complaints += 1;
      if (r.unsubscribedAt) t.unsubscribes += 1;
    }
  }
  return t;
}

function emptySeries(days: string[]): SeriesPoint[] {
  return days.map((date) => ({ date, opened: 0, clicked: 0 }));
}

function buildSeries(buckets: CampaignBucket[], days: string[]): SeriesPoint[] {
  const index = new Map(days.map((d, i) => [d, i]));
  const series = emptySeries(days);
  for (const b of buckets) {
    for (const r of b.rows) {
      if (r.openedAt) {
        const i = index.get(dayKey(r.openedAt));
        if (i !== undefined) series[i].opened += 1;
      }
      if (r.clickedAt) {
        const i = index.get(dayKey(r.clickedAt));
        if (i !== undefined) series[i].clicked += 1;
      }
    }
  }
  return series;
}

/**
 * Agrega as linhas de envio no relatório completo.
 * `rows` deve conter os envios do período atual e do anterior.
 */
export function aggregateReport(
  rows: SendRow[],
  period: ParsedPeriod,
  from: string,
  to: string,
  generatedAt: string,
  campaignFilter?: Set<string>
): ReportResult {
  const buckets = [...groupByCampaign(rows).values()].filter(
    (b) => !campaignFilter || campaignFilter.has(b.id)
  );

  const inRange = (d: Date, a: Date, b: Date) =>
    d.getTime() >= a.getTime() && d.getTime() <= b.getTime();

  const current = buckets.filter((b) =>
    inRange(b.sendDate, period.fromDate, period.toDate)
  );
  const previous = buckets.filter((b) =>
    inRange(b.sendDate, period.prevFromDate, period.prevToDate)
  );

  const cur = totalsFor(current);
  const prev = totalsFor(previous);
  const days = dayRange(period.fromDate, period.toDate);

  const campaigns: CampaignRow[] = current
    .map((b): CampaignRow => {
      const t = totalsFor([b]);
      return {
        id: b.id,
        name: b.name,
        sentAt: b.sendDate.toISOString(),
        sent: t.sent,
        delivered: t.delivered,
        openedUnique: t.opened,
        openRate: ratePct(t.opened, t.delivered),
        clickedUnique: t.clicked,
        clickRate: ratePct(t.clicked, t.delivered),
        bounces: t.bounces,
        bounceRate: ratePct(t.bounces, t.sent),
        complaints: t.complaints,
        complaintRate: ratePct(t.complaints, t.sent),
        unsubscribes: t.unsubscribes,
      };
    })
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  const seriesByCampaign: Record<string, SeriesPoint[]> = {};
  for (const b of current) {
    seriesByCampaign[b.id] = buildSeries([b], days);
  }

  return {
    generatedAt,
    period: { from, to },
    previousPeriod: {
      from: dayKey(period.prevFromDate),
      to: dayKey(period.prevToDate),
    },
    kpis: {
      campaigns: { value: cur.campaigns, previous: prev.campaigns },
      sent: { value: cur.sent, previous: prev.sent },
      delivered: { value: cur.delivered, previous: prev.delivered },
      openRate: {
        value: ratePct(cur.opened, cur.delivered),
        previous: ratePct(prev.opened, prev.delivered),
        opened: cur.opened,
        delivered: cur.delivered,
      },
      clickRate: {
        value: ratePct(cur.clicked, cur.delivered),
        previous: ratePct(prev.clicked, prev.delivered),
        clicked: cur.clicked,
        delivered: cur.delivered,
      },
      ctor: {
        value: ratePct(cur.clicked, cur.opened),
        previous: ratePct(prev.clicked, prev.opened),
      },
      bounces: {
        value: cur.bounces,
        previous: prev.bounces,
        rate: ratePct(cur.bounces, cur.sent),
        ratePrevious: ratePct(prev.bounces, prev.sent),
      },
      complaints: {
        value: cur.complaints,
        previous: prev.complaints,
        rate: ratePct(cur.complaints, cur.sent),
        ratePrevious: ratePct(prev.complaints, prev.sent),
      },
      unsubscribes: {
        value: cur.unsubscribes,
        previous: prev.unsubscribes,
        rate: ratePct(cur.unsubscribes, cur.delivered),
        ratePrevious: ratePct(prev.unsubscribes, prev.delivered),
      },
    },
    campaigns,
    series: buildSeries(current, days),
    seriesByCampaign,
  };
}
