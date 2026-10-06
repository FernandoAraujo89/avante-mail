import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  MailCheck,
  MailOpen,
  MessagesSquare,
  MousePointerClick,
  Pencil,
  Reply,
  Send,
  Workflow,
} from "lucide-react";
import { and, desc, eq } from "drizzle-orm";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { PaginacaoNaUrl } from "@/components/paginacao";
import { SendStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  automationRuns,
  automations,
  campaigns,
  campaignSends,
  contactLists,
  contacts,
  getDb,
  lists as listsTable,
} from "@/lib/db";
import { listarEnderecos } from "@/lib/contatos/enderecos";
import { usuarioDaSessao, veSoParceiros } from "@/lib/escopo-parceiros";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { naoEhLead } from "@/lib/leads";
import { recortar } from "@/lib/paginacao";
import { paginacaoDaUrl, type ParametrosDaUrl } from "@/lib/paginacao-servidor";
import { conversationIdsByContact } from "@/lib/whatsapp/conversations";

export const dynamic = "force-dynamic";

export default async function ContactHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParametrosDaUrl>;
}) {
  const { id } = await params;
  const db = getDb();

  // Lead não existe para quem vê só parceiros — nem chega a ser lido.
  const soParceiros = veSoParceiros(await usuarioDaSessao());
  const [contact] = await db
    .select()
    .from(contacts)
    .where(
      soParceiros ? and(eq(contacts.id, id), naoEhLead()) : eq(contacts.id, id)
    );

  if (!contact) notFound();

  // Todos os e-mails e telefones, com o principal primeiro e o consentimento
  // de cada um — a campanha vai para todos os que aceitam.
  const enderecos = await listarEnderecos(db, id);
  const linhaDeEnderecos = [
    ...enderecos.emails.map(
      (e) => `${e.email}${e.subscribed ? "" : " (fora do e-mail)"}`
    ),
    ...enderecos.phones.map(
      (p) =>
        `${formatPhone(p.phone)}${
          p.whatsappSubscribed || p.smsSubscribed
            ? ""
            : " (fora do WhatsApp e do SMS)"
        }`
    ),
  ].join(" · ");

  const contactListNames = (
    await db
      .select({ name: listsTable.name })
      .from(contactLists)
      .innerJoin(listsTable, eq(listsTable.id, contactLists.listId))
      .where(eq(contactLists.contactId, id))
  ).map((l) => l.name);

  // Histórico de campanhas/e-mails recebidos por este contato, do mais
  // recente para o mais antigo.
  const history = await db
    .select({
      sendId: campaignSends.id,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      automationId: automations.id,
      automationName: automations.name,
      subject: campaigns.subject,
      status: campaignSends.status,
      sentAt: campaignSends.sentAt,
      openedAt: campaignSends.openedAt,
      clickedAt: campaignSends.clickedAt,
      repliedAt: campaignSends.repliedAt,
    })
    .from(campaignSends)
    // Joins à ESQUERDA: desde a fase 2 das automações, um envio pode vir de um
    // passo de fluxo em vez de campanha. Com innerJoin, esses envios sumiam do
    // histórico do contato — ele recebeu a mensagem e a ficha não mostrava.
    .leftJoin(campaigns, eq(campaignSends.campaignId, campaigns.id))
    .leftJoin(
      automationRuns,
      eq(automationRuns.id, campaignSends.automationRunId)
    )
    .leftJoin(automations, eq(automations.id, automationRuns.automationId))
    .where(eq(campaignSends.contactId, id))
    // O id desempata: a página seguinte é outra consulta, e empate sem
    // critério pode trocar a ordem entre uma e outra.
    .orderBy(desc(campaignSends.sentAt), desc(campaignSends.id));

  const conversationId = (await conversationIdsByContact([id])).get(id);

  const received = history.filter((h) =>
    ["sent", "opened", "clicked"].includes(h.status)
  ).length;
  const opened = history.filter((h) => h.openedAt !== null).length;
  const clicked = history.filter((h) => h.clickedAt !== null).length;
  const replied = history.filter((h) => h.repliedAt !== null).length;

  // As métricas contam o histórico inteiro; a tabela mostra uma página dele.
  const pedido = await paginacaoDaUrl(
    await searchParams,
    "historico-do-contato"
  );
  const { pagina, inicio, fim } = recortar(
    history.length,
    pedido.pagina,
    pedido.linhas
  );
  const historicoDaPagina = history.slice(inicio, fim);

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/contacts">
            <ArrowLeft />
            Voltar para contatos
          </Link>
        </Button>
        <PageHeader
          title={contact.name}
          description={`${linhaDeEnderecos || "sem e-mail nem telefone"}${
            contact.company ? ` · ${contact.company}` : ""
          } · ${
            contactListNames.length > 0
              ? `Listas: ${contactListNames.join(", ")}`
              : "Sem lista"
          } · Cadastrado em ${formatDate(contact.createdAt)}`}
        >
          {contact.subscribed ? (
            <Badge variant="success">Ativo</Badge>
          ) : enderecos.emails.length === 0 ? (
            <Badge variant="secondary">Sem e-mail</Badge>
          ) : (
            <Badge variant="destructive">Descadastrado</Badge>
          )}
          {conversationId ? (
            <Button variant="outline" asChild>
              <Link href={`/conversations?c=${conversationId}`}>
                <MessagesSquare />
                Conversa no WhatsApp
              </Link>
            </Button>
          ) : null}
          <Button variant="outline" asChild>
            <Link href={`/contacts/${contact.id}/edit`}>
              <Pencil />
              Editar
            </Link>
          </Button>
        </PageHeader>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="E-mails recebidos"
          value={String(received)}
          hint={`${history.length} envio${history.length === 1 ? "" : "s"} no total`}
          icon={Send}
        />
        <MetricCard label="Abertos" value={String(opened)} icon={MailOpen} />
        <MetricCard
          label="Clicados"
          value={String(clicked)}
          icon={MousePointerClick}
        />
        <MetricCard label="Respondidos" value={String(replied)} icon={Reply} />
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-muted-foreground">
        Histórico de campanhas
      </h2>

      <Card id="historico-de-envios">
        {history.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <MailCheck className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Este contato ainda não recebeu nenhuma campanha.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recebido em</TableHead>
                <TableHead>Aberto em</TableHead>
                <TableHead>Clicado em</TableHead>
                <TableHead>Respondido em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historicoDaPagina.map((h) => (
                <TableRow key={h.sendId}>
                  <TableCell>
                    {h.campaignId ? (
                      <>
                        <Link
                          href={`/campaigns/${h.campaignId}/report`}
                          className="font-medium hover:underline"
                        >
                          {h.campaignName}
                        </Link>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {h.subject}
                        </p>
                      </>
                    ) : (
                      <>
                        {h.automationId ? (
                          <Link
                            href={`/automations/${h.automationId}/report`}
                            className="font-medium hover:underline"
                          >
                            {h.automationName}
                          </Link>
                        ) : (
                          <span className="font-medium">
                            Automação removida
                          </span>
                        )}
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Workflow className="size-3" />
                          Passo de automação
                        </p>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <SendStatusBadge status={h.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(h.sentAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(h.openedAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(h.clickedAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(h.repliedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <PaginacaoNaUrl
          chave="historico-do-contato"
          idDaLista="historico-de-envios"
          total={history.length}
          pagina={pagina}
          linhas={pedido.linhas}
          className="border-t border-border px-4 py-3"
        />
      </Card>
    </>
  );
}
