import { NextResponse } from "next/server";
import {
  and,
  avg,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  sql,
} from "drizzle-orm";

import { contactEvents, contacts, getDb, leadStages } from "@/lib/db";
import { ehLead } from "@/lib/leads";
import {
  ETAPA_DE_PERDA,
  etapasDoFunil,
  listarEtapas,
  passaramPorEtapa,
} from "@/lib/leads/etapas";
import { listarQualificacoes } from "@/lib/leads/qualificacoes";
import { lerConfiguracao } from "@/lib/leads/score";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Os números do relatório de gestão de leads — TODOS numa resposta só.
 *
 * A tela decide o que mostrar (resumido, detalhado, seções à escolha); a API
 * não sabe de níveis de propósito: mandar tudo custa um punhado de agregações
 * baratas e evita uma combinação de parâmetros que ninguém testaria inteira.
 */
export async function GET() {
  try {
    const db = getDb();
    const agora = new Date();
    const ha30Dias = new Date(agora.getTime() - 30 * 86_400_000);
    const ha12Semanas = new Date(agora.getTime() - 12 * 7 * 86_400_000);

    const entrada = sql`coalesce(${contacts.acquiredAt}, ${contacts.createdAt})`;

    const [etapas, qualificacoes, config] = await Promise.all([
      listarEtapas(true),
      listarQualificacoes(true),
      lerConfiguracao(),
    ]);

    const [
      [totais],
      [convertidos],
      porQualificacao,
      porFaixa,
      porCanal,
      porCampanha,
      porSemana,
      engajamento,
      topLeads,
    ] = await Promise.all([
      db
        .select({
          total: count(),
          novos30d: count(sql`CASE WHEN ${entrada} >= ${ha30Dias} THEN 1 END`),
          comQualificacao: count(contacts.qualification),
          quentes: count(
            sql`CASE WHEN ${contacts.leadScoreBand} IN ('quente','aquecido') THEN 1 END`
          ),
          mediaScore: avg(contacts.leadScore),
        })
        .from(contacts)
        .where(ehLead()),
      // Quem comprou/virou parceiro saiu do funil (stage nulo) — a contagem
      // vive na linha do tempo, que sobrevive à conversão.
      db
        .select({ total: countDistinct(contactEvents.contactId) })
        .from(contactEvents)
        .where(
          and(
            eq(contactEvents.type, "lead_stage_changed"),
            sql`${contactEvents.payload}->>'acao' = 'convertido em parceiro'`
          )
        ),
      db
        .select({ qualificacao: contacts.qualification, total: count() })
        .from(contacts)
        .where(ehLead())
        .groupBy(contacts.qualification),
      db
        .select({ faixa: contacts.leadScoreBand, total: count() })
        .from(contacts)
        .where(ehLead())
        .groupBy(contacts.leadScoreBand),
      db
        .select({ canal: contacts.sourceChannel, total: count() })
        .from(contacts)
        .where(ehLead())
        .groupBy(contacts.sourceChannel)
        .orderBy(desc(count())),
      db
        .select({ campanha: contacts.utmCampaign, total: count() })
        .from(contacts)
        .where(and(ehLead(), isNotNull(contacts.utmCampaign)))
        .groupBy(contacts.utmCampaign)
        .orderBy(desc(count()))
        .limit(5),
      db
        .select({
          semana: sql<string>`to_char(date_trunc('week', ${entrada}), 'YYYY-MM-DD')`,
          total: count(),
        })
        .from(contacts)
        .where(and(ehLead(), gte(sql`${entrada}`, ha12Semanas)))
        .groupBy(sql`date_trunc('week', ${entrada})`)
        .orderBy(sql`date_trunc('week', ${entrada})`),
      db
        .select({ tipo: contactEvents.type, total: count() })
        .from(contactEvents)
        .innerJoin(contacts, eq(contacts.id, contactEvents.contactId))
        .where(
          and(
            ehLead(),
            gte(contactEvents.createdAt, ha30Dias),
            inArray(contactEvents.type, [
              "email_opened",
              "email_clicked",
              "whatsapp_replied",
              "site_visited",
              "site_event",
              "lead_qualified",
              "lead_stage_changed",
            ])
          )
        )
        .groupBy(contactEvents.type),
      db
        .select({
          id: contacts.id,
          name: contacts.name,
          email: contacts.email,
          score: contacts.leadScore,
          faixa: contacts.leadScoreBand,
          qualification: contacts.qualification,
          stage: contacts.stage,
        })
        .from(contacts)
        .where(and(ehLead(), isNotNull(contacts.leadScore)))
        .orderBy(desc(contacts.leadScore))
        .limit(10),
    ]);

    // Quantos PASSARAM por cada etapa — não quantos estão nela agora. É o que
    // faz o funil ler como funil: quem avançou, pulou etapa ou converteu
    // continua contado em todas as etapas até onde chegou, via linha do tempo.
    //
    // Por contato, a posição mais funda já alcançada. A etapa desativada entra
    // pela posição dela: quem passou pelo antigo "Passou por apresentação de
    // produto" conta até "Apresentar parte técnica".
    const alcances = await db
      .select({ maisFunda: sql<number>`alcance.mais_funda` })
      .from(
        sql`(
          SELECT max(etapa.position)::int AS mais_funda
            FROM (
              SELECT ${contactEvents.contactId} AS id,
                     ${contactEvents.payload}->>'para' AS slug
                FROM ${contactEvents}
               WHERE ${contactEvents.type} = 'lead_stage_changed'
              UNION ALL
              SELECT ${contacts.id}, ${contacts.stage}
                FROM ${contacts}
               WHERE ${contacts.stage} IS NOT NULL
            ) AS passagem
            JOIN ${leadStages} AS etapa
              ON etapa.slug = passagem.slug
             -- Perder não é chegar mais fundo: quem perdeu conta até onde
             -- tinha chegado antes.
             AND etapa.slug <> ${ETAPA_DE_PERDA}
           GROUP BY passagem.id
        ) AS alcance`
      );

    const ativas = etapasDoFunil(etapas);
    const passaram = passaramPorEtapa(
      ativas.map((e) => e.position),
      alcances.map((a) => a.maisFunda)
    );
    const funil = ativas.map((e, i) => ({
      slug: e.slug,
      label: e.label,
      converte: e.convertListId !== null,
      // Todo lead entra pela primeira etapa; contar pela linha do tempo aqui
      // perderia o convertido à mão que nunca "chegou" em etapa nenhuma.
      passaram:
        i === 0 ? (totais?.total ?? 0) + (convertidos?.total ?? 0) : passaram[i],
    }));

    // Quem está em "Perdido" agora — fora da sequência do funil, mas não fora
    // do relatório. Nulo quando a etapa nem existe: a tela não mostra um zero
    // que parece medida.
    const etapaDePerda = etapas.find((e) => e.slug === ETAPA_DE_PERDA);
    const perdidos = etapaDePerda
      ? (
          await db
            .select({ total: count() })
            .from(contacts)
            .where(eq(contacts.stage, ETAPA_DE_PERDA))
        )[0]?.total ?? 0
      : null;

    const canais = porCanal.filter((c) => c.canal);
    const semCanal = porCanal.find((c) => !c.canal)?.total ?? 0;

    return NextResponse.json({
      geradoEm: agora.toISOString(),
      config,
      kpis: {
        total: totais?.total ?? 0,
        novos30d: totais?.novos30d ?? 0,
        comQualificacao: totais?.comQualificacao ?? 0,
        quentes: totais?.quentes ?? 0,
        convertidos: convertidos?.total ?? 0,
        mediaScore:
          totais?.mediaScore !== null && totais?.mediaScore !== undefined
            ? Math.round(Number(totais.mediaScore))
            : null,
      },
      funil,
      perdidos,
      qualificacoes: qualificacoes.map((q) => ({
        slug: q.slug,
        label: q.label,
        variant: q.variant,
        total:
          porQualificacao.find((r) => r.qualificacao === q.slug)?.total ?? 0,
      })),
      semQualificacao:
        porQualificacao.find((r) => r.qualificacao === null)?.total ?? 0,
      faixas: Object.fromEntries(
        porFaixa.filter((r) => r.faixa).map((r) => [r.faixa as string, r.total])
      ),
      semFaixa: porFaixa.find((r) => !r.faixa)?.total ?? 0,
      canais: canais.slice(0, 8).map((c) => ({
        canal: c.canal as string,
        total: c.total,
      })),
      outrosCanais:
        canais.slice(8).reduce((soma, c) => soma + c.total, 0) + semCanal,
      campanhas: porCampanha.map((c) => ({
        campanha: c.campanha as string,
        total: c.total,
      })),
      semanas: porSemana,
      engajamento: Object.fromEntries(
        engajamento.map((r) => [r.tipo, r.total])
      ),
      topLeads,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
