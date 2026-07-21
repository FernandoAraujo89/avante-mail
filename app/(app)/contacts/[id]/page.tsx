import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  MailCheck,
  MailOpen,
  MousePointerClick,
  Pencil,
  Reply,
  Send,
} from "lucide-react";
import { desc, eq } from "drizzle-orm";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
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
  campaigns,
  campaignSends,
  contactLists,
  contacts,
  getDb,
  lists as listsTable,
} from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ContactHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));

  if (!contact) notFound();

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
      subject: campaigns.subject,
      status: campaignSends.status,
      sentAt: campaignSends.sentAt,
      openedAt: campaignSends.openedAt,
      clickedAt: campaignSends.clickedAt,
      repliedAt: campaignSends.repliedAt,
    })
    .from(campaignSends)
    .innerJoin(campaigns, eq(campaignSends.campaignId, campaigns.id))
    .where(eq(campaignSends.contactId, id))
    .orderBy(desc(campaignSends.sentAt));

  const received = history.filter((h) =>
    ["sent", "opened", "clicked"].includes(h.status)
  ).length;
  const opened = history.filter((h) => h.openedAt !== null).length;
  const clicked = history.filter((h) => h.clickedAt !== null).length;
  const replied = history.filter((h) => h.repliedAt !== null).length;

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
          description={`${contact.email}${
            contact.company ? ` · ${contact.company}` : ""
          } · ${
            contactListNames.length > 0
              ? `Listas: ${contactListNames.join(", ")}`
              : "Sem lista"
          } · Cadastrado em ${formatDate(contact.createdAt)}`}
        >
          {contact.subscribed ? (
            <Badge variant="success">Ativo</Badge>
          ) : (
            <Badge variant="destructive">Descadastrado</Badge>
          )}
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
        <MetricCard
          label="Abertos"
          value={String(opened)}
          icon={MailOpen}
        />
        <MetricCard
          label="Clicados"
          value={String(clicked)}
          icon={MousePointerClick}
        />
        <MetricCard
          label="Respondidos"
          value={String(replied)}
          icon={Reply}
        />
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-muted-foreground">
        Histórico de campanhas
      </h2>

      <Card>
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
              {history.map((h) => (
                <TableRow key={h.sendId}>
                  <TableCell>
                    <Link
                      href={`/campaigns/${h.campaignId}/report`}
                      className="font-medium hover:underline"
                    >
                      {h.campaignName}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {h.subject}
                    </p>
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
      </Card>
    </>
  );
}
