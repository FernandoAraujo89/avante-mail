import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { and, asc, count, desc, eq, isNull, ne, or } from "drizzle-orm";

import { LeadAcoes } from "@/components/leads/lead-acoes";
import { LeadQualificacao } from "@/components/leads/lead-qualificacao";
import { LeadScoreCard } from "@/components/leads/lead-score-card";
import {
  qualificacaoInfo,
  varianteDaQualificacao,
  type QualificacaoDto,
} from "@/components/leads/qualificacoes";
import { rotuloDaFonte } from "@/lib/leads/fonte";
import { etapaPorSlug, listarEtapas } from "@/lib/leads/etapas";
import { listarQualificacoes } from "@/lib/leads/qualificacoes";
import { PageHeader } from "@/components/page-header";
import { PaginacaoNaUrl } from "@/components/paginacao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  automationRuns,
  automations,
  campaigns,
  campaignSends,
  contactEvents,
  contacts,
  getDb,
  lists as listsTable,
} from "@/lib/db";
import { formatDate, formatDateTime, formatInt } from "@/lib/format";
import { recortar } from "@/lib/paginacao";
import {
  paginacaoDaUrl,
  type ParametrosDaUrl,
} from "@/lib/paginacao-servidor";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** O que cada evento quer dizer na linha do tempo do lead. */
// Situação do lead dentro de um fluxo de automação, em português — o valor
// cru do banco (running, waiting...) não é conversa para a UI.
const FLUXO_STATUS_LABELS: Record<string, string> = {
  running: "Em andamento",
  waiting: "Aguardando",
  done: "Concluído",
  stopped: "Interrompido",
  failed: "Falhou",
};

const EVENTO_LABEL: Record<string, string> = {
  contact_created: "Entrou como lead",
  tag_added: "Tag adicionada",
  tag_removed: "Tag removida",
  list_subscribed: "Entrou na lista",
  list_unsubscribed: "Saiu da lista",
  email_unsubscribed: "Descadastrou-se do e-mail",
  email_opened: "Abriu um e-mail",
  email_clicked: "Clicou num e-mail",
  whatsapp_replied: "Respondeu no WhatsApp",
  whatsapp_unsubscribed: "Pediu para sair do WhatsApp",
  lead_stage_changed: "Andou no funil",
  lead_qualified: "Qualificado no CRM",
  lead_score_changed: "Mudou de faixa de pontuação",
  site_visited: "Visitou o site",
  site_event: "Ação no site",
};

function detalheDoEvento(
  tipo: string,
  payload: Record<string, unknown> | null,
  rotulos: Record<string, string>,
  qualificacoes: QualificacaoDto[]
): string | null {
  const rotuloDaEtapa = (slug: string | null) =>
    slug ? rotulos[slug] ?? slug : "—";
  if (!payload) return null;
  if (tipo === "lead_stage_changed") {
    const de = rotuloDaEtapa((payload.de as string) ?? null);
    const para = payload.para ? rotuloDaEtapa(payload.para as string) : "parceiro";
    return `${de} → ${para}`;
  }
  if (tipo === "lead_qualified") {
    const slug = (payload.qualificacao as string) ?? null;
    const q = qualificacaoInfo(qualificacoes, slug);
    if (!q) return slug;
    return q.potential
      ? `${q.label} · potencial ${q.potential.toLowerCase()}`
      : q.label;
  }
  if (tipo === "lead_score_changed") {
    return `${payload.de ?? "—"} → ${payload.para} (${payload.score} pontos)`;
  }
  // O caminho é o que o operador precisa ver; a URL completa não é guardada
  // (ela carregaria o próprio token de rastreio para dentro da tela).
  if (tipo === "site_visited") {
    // A rede, quando reconhecida (fase E.3); senão o host cru do referrer.
    const de =
      typeof payload.fonte === "string"
        ? ` · veio do ${rotuloDaFonte(payload.fonte)}`
        : payload.refHost
          ? ` · veio de ${payload.refHost}`
          : "";
    return `${payload.path ?? "—"}${de}`;
  }
  if (tipo === "site_event") {
    return `${payload.evento} · ${payload.path ?? "—"}`;
  }
  if (typeof payload.tag === "string") return payload.tag;
  if (typeof payload.origem === "string") {
    const pela =
      typeof payload.fonte === "string"
        ? ` · pelo ${rotuloDaFonte(payload.fonte)}`
        : "";
    return `origem: ${payload.origem}${pela}`;
  }
  return null;
}

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParametrosDaUrl>;
}) {
  const { id } = await params;
  const db = getDb();

  const [lead] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!lead) notFound();

  // Quem COMPROU e virou parceiro saiu do funil (`stage` nulo), mas a jornada
  // dele como lead — qualificação, pontos de contato, avanço até a compra — é
  // exatamente o que a gestão quer estudar. A passagem pelo funil fica na
  // linha do tempo, e é ela que decide se esta ficha existe.
  const [passagemPeloFunil] = await db
    .select({ id: contactEvents.id })
    .from(contactEvents)
    .where(
      and(
        eq(contactEvents.contactId, id),
        eq(contactEvents.type, "lead_stage_changed")
      )
    )
    .limit(1);
  const virouParceiro = !lead.stage && Boolean(passagemPeloFunil);

  // Contato que nunca foi lead não tem ficha aqui: a área de Leads é separada
  // da base de parceiros, e mostrar parceiro nela confundiria as duas.
  if (!lead.stage && !virouParceiro) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/leads">
            <ArrowLeft />
            Voltar para leads
          </Link>
        </Button>
        <Card>
          <CardContent className="grid gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{lead.name}</span>{" "}
              não é um lead — é um contato da base de relacionamento.
            </p>
            <div>
              <Button variant="outline" asChild>
                <Link href={`/contacts/${lead.id}`}>Ver na base de contatos</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  // A linha do tempo pagina (?pagina=&linhas=): antes eram só os 50 eventos
  // mais recentes, numa coluna que rolava sem fim — e quem visitou o site
  // centenas de vezes não tinha como ver o começo da jornada. A contagem vem
  // antes para a página pedida ficar presa ao que existe.
  const pedido = await paginacaoDaUrl(await searchParams, "linha-do-tempo");
  const [totalEventos] = await db
    .select({ total: count() })
    .from(contactEvents)
    .where(eq(contactEvents.contactId, id));
  const linhaDoTempo = recortar(
    totalEventos?.total ?? 0,
    pedido.pagina,
    pedido.linhas
  );

  const [
    eventos,
    envios,
    fluxos,
    listasDestino,
    etapas,
    etapaAtual,
    qualificacoes,
    [totalEnvios],
  ] = await Promise.all([
    db
      .select({
        id: contactEvents.id,
        type: contactEvents.type,
        payload: contactEvents.payload,
        createdAt: contactEvents.createdAt,
      })
      .from(contactEvents)
      .where(eq(contactEvents.contactId, id))
      // Eventos gravados na mesma transação dividem o createdAt; o id
      // desempata para a página seguinte não repetir nem pular nenhum.
      .orderBy(desc(contactEvents.createdAt), desc(contactEvents.id))
      .limit(pedido.linhas)
      .offset(linhaDoTempo.inicio),
    db
      .select({
        id: campaignSends.id,
        status: campaignSends.status,
        sentAt: campaignSends.sentAt,
        campaignName: campaigns.name,
        automationName: automations.name,
      })
      .from(campaignSends)
      .leftJoin(campaigns, eq(campaigns.id, campaignSends.campaignId))
      .leftJoin(
        automationRuns,
        eq(automationRuns.id, campaignSends.automationRunId)
      )
      .leftJoin(automations, eq(automations.id, automationRuns.automationId))
      .where(eq(campaignSends.contactId, id))
      .orderBy(desc(campaignSends.sentAt))
      .limit(20),
    db
      .select({
        id: automationRuns.id,
        status: automationRuns.status,
        nome: automations.name,
        automationId: automations.id,
      })
      .from(automationRuns)
      .innerJoin(automations, eq(automations.id, automationRuns.automationId))
      .where(eq(automationRuns.contactId, id))
      .orderBy(desc(automationRuns.enteredAt))
      .limit(10),
    // Destinos possíveis da conversão: qualquer lista que NÃO seja de leads.
    db
      .select({ id: listsTable.id, name: listsTable.name })
      .from(listsTable)
      .where(
        or(isNull(listsTable.kind), ne(listsTable.kind, "leads")) ??
          isNull(listsTable.kind)
      )
      .orderBy(asc(listsTable.name)),
      // Os rótulos das etapas vêm da tabela: a linha do tempo guarda o slug, e
      // sem a tradução ela mostraria "apresentacao-de-produto" para o operador.
      listarEtapas(true),
      lead.stage ? etapaPorSlug(lead.stage) : Promise.resolve(null),
      // As qualificações também: a ficha e a linha do tempo guardam o slug, e
      // o texto do playbook mora na tabela desde que a lista virou dado.
      listarQualificacoes(true),
      // Contagem REAL do que a exclusão apaga (a de eventos vem lá de cima).
      // As mensagens recebidas são cortadas em 20; usar o tamanho da lista
      // faria a janela dizer "20 mensagens" para quem tem 200.
      db
        .select({ total: count() })
        .from(campaignSends)
        .where(eq(campaignSends.contactId, id)),
    ]);

  const rotulosDasEtapas = Object.fromEntries(
    etapas.map((e) => [e.slug, e.label])
  );

  const qualificacaoDoLead = qualificacaoInfo(
    qualificacoes,
    lead.qualification
  );

  const origem: { rotulo: string; valor: string | null }[] = [
    { rotulo: "Canal", valor: lead.sourceChannel },
    { rotulo: "utm_source", valor: lead.utmSource },
    { rotulo: "utm_medium", valor: lead.utmMedium },
    { rotulo: "utm_campaign", valor: lead.utmCampaign },
    { rotulo: "utm_content", valor: lead.utmContent },
    { rotulo: "utm_term", valor: lead.utmTerm },
    { rotulo: "Página de entrada", valor: lead.landingPage },
    { rotulo: "Referrer", valor: lead.referrer },
    { rotulo: "Origem", valor: lead.sourceDetail },
    {
      rotulo: "Entrou em",
      valor: lead.acquiredAt ? formatDateTime(lead.acquiredAt) : null,
    },
  ];

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/leads">
            <ArrowLeft />
            Voltar para leads
          </Link>
        </Button>
        <PageHeader
          title={lead.name}
          description={`${lead.email}${
            lead.phone ? ` · ${formatPhone(lead.phone)}` : ""
          }${lead.company ? ` · ${lead.company}` : ""} · Cadastrado em ${formatDate(
            lead.createdAt
          )}`}
        >
          {qualificacaoDoLead ? (
            <Badge variant={varianteDaQualificacao(qualificacaoDoLead)}>
              {qualificacaoDoLead.label}
            </Badge>
          ) : null}
          {virouParceiro ? (
            <Badge variant="success">Virou parceiro</Badge>
          ) : (
            <Badge variant="secondary">{etapaAtual?.label ?? lead.stage}</Badge>
          )}
          {lead.subscribed ? (
            <Badge variant="success">Aceita e-mail</Badge>
          ) : (
            <Badge variant="destructive">Sem aceite de e-mail</Badge>
          )}
          <Button variant="outline" asChild>
            <Link href={`/contacts/${lead.id}/edit`}>
              <Pencil />
              Editar dados
            </Link>
          </Button>
        </PageHeader>
      </div>

      {virouParceiro ? (
        <div className="mb-6 rounded-lg border border-success-dark/30 bg-success-light/20 px-4 py-3 text-sm text-success-dark">
          Este contato comprou e virou parceiro — a ficha abaixo é a jornada
          dele como lead, congelada no dia da conversão. O relacionamento de
          agora vive na{" "}
          <Link href={`/contacts/${lead.id}`} className="font-medium underline">
            base de contatos
          </Link>
          .
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="grid gap-6">
          <LeadScoreCard leadId={lead.id} />

          <LeadQualificacao
            info={qualificacaoDoLead}
            qualificadoEm={lead.qualifiedAt}
            etapa={
              virouParceiro
                ? "Virou parceiro"
                : (etapaAtual?.label ?? lead.stage)
            }
            etapaDesde={lead.stageChangedAt}
            encerraNutricao={etapaAtual?.stopsNurturing ?? false}
          />

          {/* Converter e excluir são ações de LEAD; para quem já virou
              parceiro, as duas viveriam mentindo — a exclusão inclusive é
              recusada pela rota. */}
          {virouParceiro ? null : (
            <LeadAcoes
              leadId={lead.id}
              nome={lead.name}
              subscribed={lead.subscribed}
              listas={listasDestino}
              totalEventos={totalEventos?.total ?? 0}
              totalEnvios={totalEnvios?.total ?? 0}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>Origem</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                {origem.filter((o) => o.valor).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sem dados de origem — este lead não veio por webhook.
                  </p>
                ) : (
                  origem
                    .filter((o) => o.valor)
                    .map((o) => (
                      <div key={o.rotulo} className="flex justify-between gap-4">
                        <dt className="shrink-0 text-muted-foreground">
                          {o.rotulo}
                        </dt>
                        <dd className="truncate text-right font-medium">
                          {o.valor}
                        </dd>
                      </div>
                    ))
                )}
              </dl>
              {(lead.tags ?? []).length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-4">
                  {(lead.tags ?? []).map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {fluxos.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Automações</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {fluxos.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <Link
                      href={`/automations/${f.automationId}/report`}
                      className="truncate font-medium hover:underline"
                    >
                      {f.nome}
                    </Link>
                    <Badge variant="secondary">
                      {FLUXO_STATUS_LABELS[f.status] ?? f.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card id="linha-do-tempo">
          <CardHeader>
            <CardTitle>Linha do tempo</CardTitle>
          </CardHeader>
          <CardContent>
            {eventos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum ponto de contato registrado ainda.
              </p>
            ) : (
              <ol className="grid gap-3">
                {eventos.map((e) => {
                  const detalhe = detalheDoEvento(
                    e.type,
                    e.payload as Record<string, unknown> | null,
                    rotulosDasEtapas,
                    qualificacoes
                  );
                  return (
                    <li
                      key={e.id}
                      className="flex items-start justify-between gap-4 border-b border-border pb-3 last:border-b-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {EVENTO_LABEL[e.type] ?? e.type}
                        </p>
                        {detalhe ? (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {detalhe}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDateTime(e.createdAt)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            <PaginacaoNaUrl
              chave="linha-do-tempo"
              idDaLista="linha-do-tempo"
              total={totalEventos?.total ?? 0}
              pagina={linhaDoTempo.pagina}
              linhas={pedido.linhas}
              className="mt-4 border-t border-border pt-4"
            />

            {envios.length > 0 ? (
              <div className="mt-6 border-t border-border pt-4">
                <p className="mb-2 text-sm font-semibold text-muted-foreground">
                  Mensagens recebidas
                </p>
                <ul className="grid gap-2 text-sm">
                  {envios.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="truncate">
                        {s.campaignName ?? s.automationName ?? "—"}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDateTime(s.sentAt)}
                      </span>
                    </li>
                  ))}
                </ul>
                {/* Aqui ficam só as 20 mais recentes; a lista inteira, paginada,
                    é o histórico do contato. */}
                {(totalEnvios?.total ?? 0) > envios.length ? (
                  <Link
                    href={`/contacts/${lead.id}`}
                    className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
                  >
                    Ver as {formatInt(totalEnvios?.total ?? 0)} mensagens no
                    histórico do contato
                  </Link>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
