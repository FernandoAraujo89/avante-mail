import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  MailOpen,
  MailWarning,
  MousePointerClick,
  Send,
  ShieldAlert,
  Users,
} from "lucide-react";
import { asc, eq, inArray } from "drizzle-orm";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import {
  CampaignStatusBadge,
  SendStatusBadge,
} from "@/components/status-badge";
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
  contacts,
  getDb,
  lists as listsTable,
} from "@/lib/db";
import { formatDateTime, formatPercent, listsLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CampaignReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id));

  if (!campaign) notFound();

  const campaignListNames =
    campaign.lists && campaign.lists.length > 0
      ? (
          await db
            .select({ name: listsTable.name })
            .from(listsTable)
            .where(inArray(listsTable.id, campaign.lists))
        ).map((l) => l.name)
      : [];

  const sends = await db
    .select({
      id: campaignSends.id,
      status: campaignSends.status,
      sentAt: campaignSends.sentAt,
      openedAt: campaignSends.openedAt,
      clickedAt: campaignSends.clickedAt,
      bounceType: campaignSends.bounceType,
      complainedAt: campaignSends.complainedAt,
      contactName: contacts.name,
      contactEmail: contacts.email,
      contactCompany: contacts.company,
    })
    .from(campaignSends)
    .innerJoin(contacts, eq(campaignSends.contactId, contacts.id))
    .where(eq(campaignSends.campaignId, id))
    .orderBy(asc(contacts.name));

  const sent = sends.filter((s) =>
    ["sent", "opened", "clicked"].includes(s.status)
  ).length;
  const opened = sends.filter((s) => s.openedAt !== null).length;
  const clicked = sends.filter((s) => s.clickedAt !== null).length;
  const failed = sends.filter((s) => s.status === "failed").length;
  const pending = sends.filter((s) => s.status === "pending").length;
  const bouncedHard = sends.filter((s) => s.bounceType === "hard").length;
  const bouncedSoft = sends.filter((s) => s.bounceType === "soft").length;
  const bounced = bouncedHard + bouncedSoft;
  const complained = sends.filter((s) => s.complainedAt !== null).length;

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/campaigns">
            <ArrowLeft />
            Voltar para campanhas
          </Link>
        </Button>
        <PageHeader
          title={campaign.name}
          description={`Assunto: ${campaign.subject} · ${listsLabel(campaignListNames)}${
            campaign.sentAt
              ? ` · Concluída em ${formatDateTime(campaign.sentAt)}`
              : ""
          }`}
        >
          <CampaignStatusBadge status={campaign.status} />
        </PageHeader>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Destinatários"
          value={String(sends.length)}
          hint={pending > 0 ? `${pending} pendentes` : "Fila concluída"}
          icon={Users}
        />
        <MetricCard label="Enviados" value={String(sent)} icon={Send} />
        <MetricCard
          label="Abertos"
          value={String(opened)}
          hint={`Taxa: ${formatPercent(opened, sent)}`}
          icon={MailOpen}
        />
        <MetricCard
          label="Clicados"
          value={String(clicked)}
          hint={`Taxa: ${formatPercent(clicked, sent)}`}
          icon={MousePointerClick}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="Devolvidos"
          value={String(bounced)}
          hint={
            bounced > 0
              ? `${bouncedHard} endereço(s) inválido(s) · ${bouncedSoft} temporário(s)`
              : "Nenhuma devolução"
          }
          icon={MailWarning}
        />
        <MetricCard
          label="Marcados como spam"
          value={String(complained)}
          hint={
            complained > 0
              ? "Contatos suprimidos automaticamente"
              : "Nenhuma reclamação"
          }
          icon={ShieldAlert}
        />
        <MetricCard
          label="Falhas de envio"
          value={String(failed)}
          hint="Erro técnico (não é devolução nem spam)"
          icon={AlertTriangle}
        />
      </div>

      <Card className="mt-6">
        {sends.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nenhum envio registrado para esta campanha.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contato</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Enviado em</TableHead>
                <TableHead>Aberto em</TableHead>
                <TableHead>Clicado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sends.map((send) => (
                <TableRow key={send.id}>
                  <TableCell>
                    <p className="font-medium">{send.contactName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {send.contactEmail}
                      {send.contactCompany ? ` · ${send.contactCompany}` : ""}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SendStatusBadge status={send.status} />
                      {send.complainedAt ? (
                        <Badge variant="warning">Spam</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(send.sentAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(send.openedAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(send.clickedAt)}
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
