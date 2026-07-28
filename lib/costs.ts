import { and, eq, isNotNull, sql } from "drizzle-orm";

import { campaigns, campaignSends, getDb, whatsappTemplates } from "@/lib/db";
import {
  sesPricePerEmailUsd,
  usdToBrlRate,
  whatsAppPriceUsd,
} from "@/lib/pricing";

// Consolidação do consumo (US$/R$) por mês e por canal, a partir dos envios já
// registrados. Base de cobrança: e-mail = envios aceitos pelo SES (sentAt);
// WhatsApp = mensagens entregues (deliveredAt), na tarifa da categoria do
// modelo. O mês é o da cobrança (envio/entrega), no fuso do Brasil.

export interface MonthlyConsumption {
  month: string; // "YYYY-MM"
  emailUsd: number;
  whatsappUsd: number;
  totalUsd: number;
  emailBrl: number;
  whatsappBrl: number;
  totalBrl: number;
}

export interface ConsumptionSummary {
  months: MonthlyConsumption[];
  totalUsd: number;
  totalBrl: number;
  emailUsd: number;
  whatsappUsd: number;
  rate: number;
}

export async function monthlyConsumption(
  monthsBack = 6
): Promise<ConsumptionSummary> {
  const db = getDb();
  const rate = usdToBrlRate();

  // Fuso inline como literal (constante) — se fosse parâmetro, o Drizzle o
  // emitiria com placeholders diferentes no SELECT e no GROUP BY, e o Postgres
  // não reconheceria a expressão agrupada.
  const emailMonth = sql<string>`to_char(${campaignSends.sentAt} at time zone 'America/Sao_Paulo', 'YYYY-MM')`;
  const whatsappMonth = sql<string>`to_char(${campaignSends.deliveredAt} at time zone 'America/Sao_Paulo', 'YYYY-MM')`;

  // E-mail: e-mails aceitos pelo SES, por mês.
  const emailRows = await db
    .select({ month: emailMonth, count: sql<number>`count(*)` })
    .from(campaignSends)
    .innerJoin(campaigns, eq(campaignSends.campaignId, campaigns.id))
    .where(
      and(eq(campaigns.channel, "email"), isNotNull(campaignSends.sentAt))
    )
    .groupBy(emailMonth);

  // WhatsApp: mensagens entregues, por mês e categoria do modelo.
  const whatsappRows = await db
    .select({
      month: whatsappMonth,
      category: whatsappTemplates.category,
      count: sql<number>`count(*)`,
    })
    .from(campaignSends)
    .innerJoin(campaigns, eq(campaignSends.campaignId, campaigns.id))
    .leftJoin(
      whatsappTemplates,
      eq(campaigns.whatsappTemplateId, whatsappTemplates.id)
    )
    .where(
      and(
        eq(campaigns.channel, "whatsapp"),
        isNotNull(campaignSends.deliveredAt)
      )
    )
    .groupBy(whatsappMonth, whatsappTemplates.category);

  const byMonth = new Map<string, { emailUsd: number; whatsappUsd: number }>();
  const bucket = (month: string) => {
    let entry = byMonth.get(month);
    if (!entry) {
      entry = { emailUsd: 0, whatsappUsd: 0 };
      byMonth.set(month, entry);
    }
    return entry;
  };

  for (const row of emailRows) {
    if (!row.month) continue;
    bucket(row.month).emailUsd += Number(row.count) * sesPricePerEmailUsd();
  }
  for (const row of whatsappRows) {
    if (!row.month) continue;
    bucket(row.month).whatsappUsd +=
      Number(row.count) * whatsAppPriceUsd(row.category);
  }

  const months = [...byMonth.entries()]
    .map(([month, v]): MonthlyConsumption => {
      const totalUsd = v.emailUsd + v.whatsappUsd;
      return {
        month,
        emailUsd: v.emailUsd,
        whatsappUsd: v.whatsappUsd,
        totalUsd,
        emailBrl: v.emailUsd * rate,
        whatsappBrl: v.whatsappUsd * rate,
        totalBrl: totalUsd * rate,
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, monthsBack);

  const emailUsd = months.reduce((s, m) => s + m.emailUsd, 0);
  const whatsappUsd = months.reduce((s, m) => s + m.whatsappUsd, 0);
  const totalUsd = emailUsd + whatsappUsd;

  return {
    months,
    emailUsd,
    whatsappUsd,
    totalUsd,
    totalBrl: totalUsd * rate,
    rate,
  };
}

/** "2026-07" → "07/2026". */
export function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  return `${m}/${year}`;
}
