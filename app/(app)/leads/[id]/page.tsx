import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { asc, desc, eq, isNull, ne, or } from "drizzle-orm";

import { LeadAcoes } from "@/components/leads/lead-acoes";
import { LeadScoreCard } from "@/components/leads/lead-score-card";
import { estagioLabel } from "@/components/leads/estagios";
import { PageHeader } from "@/components/page-header";
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
import { formatDate, formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** O que cada evento quer dizer na linha do tempo do lead. */
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
  lead_stage_changed: "Mudou de estágio",
  lead_score_changed: "Mudou de faixa de pontuação",
  site_visited: "Visitou o site",
  site_event: "Ação no site",
};

function detalheDoEvento(
  tipo: string,
  payload: Record<string, unknown> | null
): string | null {
  if (!payload) return null;
  if (tipo === "lead_stage_changed") {
    const de = estagioLabel((payload.de as string) ?? null);
    const para = payload.para ? estagioLabel(payload.para as string) : "parceiro";
    return `${de} → ${para}`;
  }
  if (tipo === "lead_score_changed") {
    return `${payload.de ?? "—"} → ${payload.para} (${payload.score} pontos)`;
  }
  // O caminho é o que o operador precisa ver; a URL completa não é guardada
  // (ela carregaria o próprio token de rastreio para dentro da tela).
  if (tipo === "site_visited") {
    const de = payload.refHost ? ` · veio de ${payload.refHost}` : "";
    return `${payload.path ?? "—"}${de}`;
  }
  if (tipo === "site_event") {
    return `${payload.evento} · ${payload.path ?? "—"}`;
  }
  if (typeof payload.tag === "string") return payload.tag;
  if (typeof payload.origem === "string") return `origem: ${payload.origem}`;
  return null;
}

export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();

  const [lead] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!lead) notFound();

  // Contato que não é lead não tem ficha aqui: a área de Leads é separada da
  // base de parceiros, e mostrar parceiro nela confundiria as duas.
  if (!lead.stage) {
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

  const [eventos, envios, fluxos, listasDestino] = await Promise.all([
    db
      .select({
        id: contactEvents.id,
        type: contactEvents.type,
        payload: contactEvents.payload,
        createdAt: contactEvents.createdAt,
      })
      .from(contactEvents)
      .where(eq(contactEvents.contactId, id))
      .orderBy(desc(contactEvents.createdAt))
      .limit(50),
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
  ]);

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
          <Badge variant="warning">{estagioLabel(lead.stage)}</Badge>
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

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="grid gap-6">
          <LeadScoreCard leadId={lead.id} />

          <LeadAcoes
            leadId={lead.id}
            estagio={lead.stage}
            subscribed={lead.subscribed}
            listas={listasDestino}
          />

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
                    <Badge variant="secondary">{f.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card>
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
                    e.payload as Record<string, unknown> | null
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
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
