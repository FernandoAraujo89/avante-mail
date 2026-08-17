import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import {
  campaigns,
  campaignSends,
  contacts,
  getDb,
  whatsappTemplates,
} from "@/lib/db";
import { campaignCost } from "@/lib/pricing";
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
        smsSegments: campaignSends.smsSegments,
        smsSegmentsBilled: campaignSends.smsSegmentsBilled,
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

    let metrics;
    let cost;
    if (campaign.channel === "whatsapp") {
      const delivered = sends.filter(
        (s) => s.deliveredAt !== null || s.status === "read"
      ).length;
      let whatsappCategory: string | null = null;
      if (campaign.whatsappTemplateId) {
        const [tpl] = await db
          .select({ category: whatsappTemplates.category })
          .from(whatsappTemplates)
          .where(eq(whatsappTemplates.id, campaign.whatsappTemplateId));
        whatsappCategory = tpl?.category ?? null;
      }
      metrics = {
        total: sends.length,
        // "Enviada" = deixou o sistema com sucesso (qualquer estágio).
        sent: sends.filter((s) =>
          ["sent", "delivered", "read"].includes(s.status)
        ).length,
        delivered,
        read: sends.filter((s) => s.readAt !== null).length,
        replied: sends.filter((s) => s.repliedAt !== null).length,
        failed,
        // 131049 = limite de marketing do destinatário (esperado; não é
        // erro técnico). Destacado à parte no relatório.
        frequencyCapped: sends.filter((s) => s.errorCode === "131049").length,
        pending,
      };
      // Meta cobra por mensagem entregue, na tarifa da categoria do modelo.
      cost = campaignCost({
        channel: "whatsapp",
        chargeable: delivered,
        whatsappCategory,
      });
    } else if (campaign.channel === "sms") {
      const enviados = sends.filter((s) => s.sentAt !== null);
      metrics = {
        total: sends.length,
        sent: enviados.length,
        // O status callback da Twilio confirma a entrega na operadora. Nem
        // toda operadora devolve confirmação, então "entregue" é sempre menor
        // ou igual a "enviado" — e nunca é a base da cobrança.
        delivered: sends.filter((s) => s.deliveredAt !== null).length,
        replied: sends.filter((s) => s.repliedAt !== null).length,
        failed,
        // 21610 = destinatário pediu para sair; 21614 = número inválido ou
        // fixo. Os dois já tiraram o contato do canal, então valem como
        // informação de higiene da base, não como falha técnica.
        optedOut: sends.filter(
          (s) => s.errorCode === "21610" || s.errorCode === "21614"
        ).length,
        pending,
        // Vale o que a Twilio COBROU; sem isso, a nossa contagem; sem as duas,
        // 1 — o piso de qualquer SMS, nunca 0. Com 0 a soma inteira podia zerar
        // e `campaignCost` receberia esse zero como legítimo (0 não é nullish):
        // a campanha apareceria custando R$ 0,00.
        segments: enviados.reduce(
          (soma, s) => soma + (s.smsSegmentsBilled ?? s.smsSegments ?? 1),
          0
        ),
        // Quanto NÓS contamos, para a tela poder mostrar a divergência: se os
        // dois números não baterem, algo reescreveu a mensagem depois da nossa
        // contagem e o custo real é o de cima.
        segmentsCounted: enviados.reduce(
          (soma, s) => soma + (s.smsSegments ?? 1),
          0
        ),
      };
      // A Twilio cobra ao entregar a mensagem à operadora — conta sentAt, como
      // o e-mail, e não deliveredAt como o WhatsApp: a mensagem já foi paga
      // mesmo quando a confirmação de entrega não volta.
      cost = campaignCost({
        channel: "sms",
        chargeable: enviados.length,
        smsSegments: metrics.segments,
      });
    } else {
      const chargeableEmails = sends.filter((s) => s.sentAt !== null).length;
      metrics = {
        total: sends.length,
        sent: sends.filter((s) =>
          ["sent", "opened", "clicked"].includes(s.status)
        ).length,
        opened: sends.filter((s) => s.openedAt !== null).length,
        clicked: sends.filter((s) => s.clickedAt !== null).length,
        failed,
        pending,
      };
      // SES cobra por e-mail aceito (todo envio com sentAt).
      cost = campaignCost({ channel: "email", chargeable: chargeableEmails });
    }

    return NextResponse.json({ campaign, metrics, cost, sends });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
