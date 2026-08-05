import { NextRequest, NextResponse } from "next/server";
import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import {
  contacts,
  getDb,
  LEAD_SCORE_BANDS,
  LEAD_STAGES,
  type LeadScoreBand,
  type LeadStage,
} from "@/lib/db";
import { ehLead } from "@/lib/leads";
import { lerConfiguracao } from "@/lib/leads/score";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Valor de filtro da visão derivada (ver o uso, abaixo). */
const PRONTOS = "prontos";

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
    const faixa = params.get("faixa")?.trim();

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
    // "Prontos para enviar" é uma VISÃO derivada, não um estágio.
    //
    // Se fosse estágio, alguém teria de mover o lead à mão quando ele
    // esquentasse — e o dia em que esquecesse, a lista mentiria. Derivando de
    // quente + ainda-não-entregue, ela se mantém sozinha e nunca desanda em
    // relação à pontuação, que é quem manda aqui.
    if (estagio === PRONTOS) {
      condicoes.push(eq(contacts.stage, "nutrindo"));
      condicoes.push(eq(contacts.leadScoreBand, "quente"));
    } else if (estagio && LEAD_STAGES.includes(estagio as LeadStage)) {
      condicoes.push(eq(contacts.stage, estagio as LeadStage));
    }
    if (canal) condicoes.push(eq(contacts.sourceChannel, canal));
    if (faixa && LEAD_SCORE_BANDS.includes(faixa as LeadScoreBand)) {
      condicoes.push(eq(contacts.leadScoreBand, faixa as LeadScoreBand));
    }

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
        leadScore: contacts.leadScore,
        leadScoreBand: contacts.leadScoreBand,
        enviadoAoComercialEm: contacts.enviadoAoComercialEm,
      })
      .from(contacts)
      .where(and(...condicoes))
      // Mais quente primeiro: a lista existe para dizer com quem falar AGORA.
      // NULLS LAST porque lead recém-criado ainda não passou pelo worker, e ele
      // não pode encabeçar a lista só por não ter nota.
      .orderBy(
        sql`${contacts.leadScore} DESC NULLS LAST`,
        desc(contacts.acquiredAt),
        desc(contacts.createdAt)
      );

    // Contagem por estágio do funil INTEIRO, não do filtro: é o painel de "onde
    // estão meus leads", e ele encolher junto com a busca não responderia isso.
    const porEstagio = await db
      .select({ stage: contacts.stage, total: count() })
      .from(contacts)
      .where(ehLead())
      .groupBy(contacts.stage);

    // Quantos estão quentes e ainda não foram entregues. É o número que faz a
    // pessoa abrir a tela: a fila de oportunidade que o comercial ainda não viu.
    const [pronto] = await db
      .select({ total: count() })
      .from(contacts)
      .where(
        and(
          ehLead(),
          eq(contacts.stage, "nutrindo"),
          eq(contacts.leadScoreBand, "quente")
        )
      );

    // Canais existentes, para o filtro só oferecer o que existe de verdade.
    const canais = await db
      .select({ canal: contacts.sourceChannel, total: count() })
      .from(contacts)
      .where(ehLead())
      .groupBy(contacts.sourceChannel)
      .orderBy(desc(count()));

    // Distribuição por faixa — o "quantos estão quentes" do painel.
    const porFaixa = await db
      .select({ faixa: contacts.leadScoreBand, total: count() })
      .from(contacts)
      .where(ehLead())
      .groupBy(contacts.leadScoreBand);

    // A barra de calor precisa saber onde fica o "quente" para desenhar a
    // escala. Vem daqui e não de uma constante: o limiar é editável em
    // /leads/pontuacao, e uma barra com escala fixa mentiria no dia seguinte.
    const config = await lerConfiguracao();

    return NextResponse.json({
      leads,
      config,
      funil: Object.fromEntries(porEstagio.map((r) => [r.stage, r.total])),
      prontos: pronto?.total ?? 0,
      faixas: Object.fromEntries(
        porFaixa.filter((r) => r.faixa).map((r) => [r.faixa as string, r.total])
      ),
      canais: canais
        .filter((c) => c.canal)
        .map((c) => ({ canal: c.canal as string, total: c.total })),
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
