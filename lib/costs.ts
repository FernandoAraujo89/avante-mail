import { and, eq, isNotNull, sql } from "drizzle-orm";

import {
  automationSteps,
  campaigns,
  campaignSends,
  getDb,
  whatsappTemplates,
} from "@/lib/db";
import {
  sesPricePerEmailUsd,
  smsPricePerSegmentUsd,
  usdToBrlRate,
  whatsAppPriceUsd,
} from "@/lib/pricing";

// Consolidação do consumo (US$/R$) por mês e por canal, a partir dos envios já
// registrados. Base de cobrança: e-mail = envios aceitos pelo SES (sentAt);
// WhatsApp = mensagens entregues (deliveredAt), na tarifa da categoria do
// modelo; SMS = SEGMENTOS das mensagens entregues à operadora (sentAt, como o
// e-mail — a Twilio cobra na saída, confirme a operadora ou não). O mês é o da
// cobrança (envio/entrega), no fuso do Brasil.
//
// Conta campanhas E automações: desde a fase 2 do plano de automações, o passo
// de envio grava na mesma campaign_sends. Dinheiro gasto por automação aparece
// aqui junto do resto — custo que não aparece é custo que ninguém controla.

export interface MonthlyConsumption {
  month: string; // "YYYY-MM"
  /** Campanhas de e-mail (não inclui o Avante News). */
  emailUsd: number;
  /** Avante News — contabilizado à parte das campanhas. */
  newsUsd: number;
  whatsappUsd: number;
  smsUsd: number;
  totalUsd: number;
  emailBrl: number;
  newsBrl: number;
  whatsappBrl: number;
  smsBrl: number;
  totalBrl: number;
}

export interface ConsumptionSummary {
  months: MonthlyConsumption[];
  totalUsd: number;
  totalBrl: number;
  emailUsd: number;
  newsUsd: number;
  whatsappUsd: number;
  smsUsd: number;
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
  // Dois recortes de mês, não três: e-mail e SMS são cobrados na saída (sentAt),
  // só o WhatsApp é cobrado na entrega confirmada (deliveredAt).
  const sentMonth = sql<string>`to_char(${campaignSends.sentAt} at time zone 'America/Sao_Paulo', 'YYYY-MM')`;
  const deliveredMonth = sql<string>`to_char(${campaignSends.deliveredAt} at time zone 'America/Sao_Paulo', 'YYYY-MM')`;

  // Os joins com campaigns são à ESQUERDA de propósito: envio de automação não
  // tem campanha (campaign_sends.campaign_id nulo) e mesmo assim foi cobrado.
  // O canal vem da própria linha do envio, não da campanha.

  // E-mail: e-mails aceitos pelo SES, por mês e por tipo (campanha × News).
  // Envio de automação não tem kind — conta como campanha.
  const emailRows = await db
    .select({
      month: sentMonth,
      kind: campaigns.kind,
      count: sql<number>`count(*)`,
    })
    .from(campaignSends)
    .leftJoin(campaigns, eq(campaignSends.campaignId, campaigns.id))
    .where(
      and(eq(campaignSends.channel, "email"), isNotNull(campaignSends.sentAt))
    )
    .groupBy(sentMonth, campaigns.kind);

  // WhatsApp: mensagens entregues, por mês e categoria do modelo. O modelo do
  // envio de automação está no config do passo.
  const whatsappRows = await db
    .select({
      month: deliveredMonth,
      category: whatsappTemplates.category,
      count: sql<number>`count(*)`,
    })
    .from(campaignSends)
    .leftJoin(campaigns, eq(campaignSends.campaignId, campaigns.id))
    .leftJoin(
      automationSteps,
      eq(campaignSends.automationStepId, automationSteps.id)
    )
    .leftJoin(
      whatsappTemplates,
      sql`${whatsappTemplates.id} = coalesce(
        ${campaigns.whatsappTemplateId},
        (${automationSteps.config} ->> 'whatsappTemplateId')::uuid
      )`
    )
    .where(
      and(
        eq(campaignSends.channel, "whatsapp"),
        isNotNull(campaignSends.deliveredAt)
      )
    )
    .groupBy(deliveredMonth, whatsappTemplates.category);

  // SMS: SEGMENTOS que saíram, não mensagens — a Twilio cobra por segmento, e a
  // mesma campanha custa o dobro se o texto passar de 160 caracteres. Sem join:
  // não há tarifa por categoria nem separação de News no canal.
  //
  // O coalesce cobre envio gravado antes da coluna sms_segments existir: vale 1
  // segmento, o piso real de qualquer SMS. Somar como zero seria dizer que o
  // canal mais caro não gastou nada.
  const smsRows = await db
    .select({
      month: sentMonth,
      // Ordem da preferência: o que a Twilio cobrou (NumSegments), depois a
      // nossa contagem no envio, e 1 como piso para linha antiga sem nenhum
      // dos dois — nenhum SMS custa menos que um segmento.
      segments: sql<number>`sum(coalesce(${campaignSends.smsSegmentsBilled}, ${campaignSends.smsSegments}, 1))`,
    })
    .from(campaignSends)
    .where(
      and(eq(campaignSends.channel, "sms"), isNotNull(campaignSends.sentAt))
    )
    .groupBy(sentMonth);

  const byMonth = new Map<
    string,
    { emailUsd: number; newsUsd: number; whatsappUsd: number; smsUsd: number }
  >();
  const bucket = (month: string) => {
    let entry = byMonth.get(month);
    if (!entry) {
      entry = { emailUsd: 0, newsUsd: 0, whatsappUsd: 0, smsUsd: 0 };
      byMonth.set(month, entry);
    }
    return entry;
  };

  for (const row of emailRows) {
    if (!row.month) continue;
    const usd = Number(row.count) * sesPricePerEmailUsd();
    if (row.kind === "news") bucket(row.month).newsUsd += usd;
    else bucket(row.month).emailUsd += usd;
  }
  for (const row of whatsappRows) {
    if (!row.month) continue;
    bucket(row.month).whatsappUsd +=
      Number(row.count) * whatsAppPriceUsd(row.category);
  }
  for (const row of smsRows) {
    if (!row.month) continue;
    bucket(row.month).smsUsd += Number(row.segments) * smsPricePerSegmentUsd();
  }

  const months = [...byMonth.entries()]
    .map(([month, v]): MonthlyConsumption => {
      const totalUsd = v.emailUsd + v.newsUsd + v.whatsappUsd + v.smsUsd;
      return {
        month,
        emailUsd: v.emailUsd,
        newsUsd: v.newsUsd,
        whatsappUsd: v.whatsappUsd,
        smsUsd: v.smsUsd,
        totalUsd,
        emailBrl: v.emailUsd * rate,
        newsBrl: v.newsUsd * rate,
        whatsappBrl: v.whatsappUsd * rate,
        smsBrl: v.smsUsd * rate,
        totalBrl: totalUsd * rate,
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, monthsBack);

  const emailUsd = months.reduce((s, m) => s + m.emailUsd, 0);
  const newsUsd = months.reduce((s, m) => s + m.newsUsd, 0);
  const whatsappUsd = months.reduce((s, m) => s + m.whatsappUsd, 0);
  const smsUsd = months.reduce((s, m) => s + m.smsUsd, 0);
  const totalUsd = emailUsd + newsUsd + whatsappUsd + smsUsd;

  return {
    months,
    emailUsd,
    newsUsd,
    whatsappUsd,
    smsUsd,
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
