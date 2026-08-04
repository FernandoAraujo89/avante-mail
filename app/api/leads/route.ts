import { NextRequest, NextResponse } from "next/server";
import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";

import { contacts, getDb, LEAD_STAGES, type LeadStage } from "@/lib/db";
import { ehLead } from "@/lib/leads";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * A área de Leads (docs/plano-webhooks-leads.md, seção 8).
 *
 * Rota própria, e não um filtro de /api/contacts, porque a gestão de lead é
 * separada da base de parceiros: o público das campanhas é parceiro, cliente e
 * colaborador; lead vive aqui. Manter as duas listagens separadas evita que um
 * filtro esquecido numa tela vaze lead para a outra.
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const params = request.nextUrl.searchParams;

    const busca = params.get("busca")?.trim();
    const estagio = params.get("estagio")?.trim();
    const canal = params.get("canal")?.trim();

    // Ser lead é a condição de base — nunca opcional nesta rota.
    const condicoes: SQL[] = [ehLead()];

    if (busca) {
      const termo = `%${busca}%`;
      const alvo = or(
        ilike(contacts.name, termo),
        ilike(contacts.email, termo),
        ilike(contacts.company, termo),
        ilike(contacts.phone, termo)
      );
      if (alvo) condicoes.push(alvo);
    }
    if (estagio && LEAD_STAGES.includes(estagio as LeadStage)) {
      condicoes.push(eq(contacts.stage, estagio as LeadStage));
    }
    if (canal) condicoes.push(eq(contacts.sourceChannel, canal));

    const leads = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
        company: contacts.company,
        tags: contacts.tags,
        stage: contacts.stage,
        subscribed: contacts.subscribed,
        whatsappSubscribed: contacts.whatsappSubscribed,
        sourceChannel: contacts.sourceChannel,
        utmSource: contacts.utmSource,
        utmMedium: contacts.utmMedium,
        utmCampaign: contacts.utmCampaign,
        landingPage: contacts.landingPage,
        sourceDetail: contacts.sourceDetail,
        acquiredAt: contacts.acquiredAt,
        createdAt: contacts.createdAt,
      })
      .from(contacts)
      .where(and(...condicoes))
      .orderBy(desc(contacts.acquiredAt), desc(contacts.createdAt));

    // Contagem por estágio do funil INTEIRO, não do filtro: é o painel de "onde
    // estão meus leads", e ele encolher junto com a busca não responderia isso.
    const porEstagio = await db
      .select({ stage: contacts.stage, total: count() })
      .from(contacts)
      .where(ehLead())
      .groupBy(contacts.stage);

    // Canais existentes, para o filtro só oferecer o que existe de verdade.
    const canais = await db
      .select({ canal: contacts.sourceChannel, total: count() })
      .from(contacts)
      .where(ehLead())
      .groupBy(contacts.sourceChannel)
      .orderBy(desc(count()));

    return NextResponse.json({
      leads,
      funil: Object.fromEntries(porEstagio.map((r) => [r.stage, r.total])),
      canais: canais
        .filter((c) => c.canal)
        .map((c) => ({ canal: c.canal as string, total: c.total })),
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
