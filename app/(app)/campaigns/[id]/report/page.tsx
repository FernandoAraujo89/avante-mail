import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCheck,
  MailOpen,
  MailWarning,
  MessageCircle,
  MessageSquareReply,
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
import { formatPhone } from "@/lib/phone";

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
      deliveredAt: campaignSends.deliveredAt,
      readAt: campaignSends.readAt,
      repliedAt: campaignSends.repliedAt,
      errorCode: campaignSends.errorCode,
      errorMessage: campaignSends.errorMessage,
      bounceType: campaignSends.bounceType,
      complainedAt: campaignSends.complainedAt,
      contactName: contacts.name,
      contactEmail: contacts.email,
      contactPhone: contacts.phone,
      contactCompany: contacts.company,
    })
    .from(campaignSends)
    .innerJoin(contacts, eq(campaignSends.contactId, contacts.id))
    .where(eq(campaignSends.campaignId, id))
    .orderBy(asc(contacts.name));

  const isWhatsApp = campaign.channel === "whatsapp";
  const pending = sends.filter((s) => s.status === "pending").length;
  const failed = sends.filter((s) => s.status === "failed").length;

  const header = (
    <div className="mb-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
        <Link href="/campaigns">
          <ArrowLeft />
          Voltar para campanhas
        </Link>
      </Button>
      <PageHeader
        title={campaign.name}
        description={`${
          isWhatsApp
            ? "Campanha de WhatsApp"
            : `Assunto: ${campaign.subject}`
        } · ${listsLabel(campaignListNames)}${
          campaign.sentAt
            ? ` · Concluída em ${formatDateTime(campaign.sentAt)}`
            : ""
        }`}
      >
        <div className="flex items-center gap-2">
          {isWhatsApp ? <Badge variant="info">WhatsApp</Badge> : null}
          <CampaignStatusBadge status={campaign.status} />
        </div>
      </PageHeader>
    </div>
  );

  if (isWhatsApp) {
    const sent = sends.filter((s) =>
      ["sent", "delivered", "read"].includes(s.status)
    ).length;
    const delivered = sends.filter(
      (s) => s.deliveredAt !== null || s.status === "read"
    ).length;
    const read = sends.filter((s) => s.readAt !== null).length;
    const replied = sends.filter((s) => s.repliedAt !== null).length;
    const frequencyCapped = sends.filter(
      (s) => s.errorCode === "131049"
    ).length;

    return (
      <>
        {header}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Destinatários"
            value={String(sends.length)}
            hint={pending > 0 ? `${pending} na fila` : "Fila concluída"}
            icon={Users}
          />
          <MetricCard label="Enviadas" value={String(sent)} icon={Send} />
          <MetricCard
            label="Entregues"
            value={String(delivered)}
            hint={`Taxa: ${formatPercent(delivered, sent)}`}
            icon={CheckCheck}
          />
          <MetricCard
            label="Lidas"
            value={String(read)}
            hint={`Taxa: ${formatPercent(read, delivered)}`}
            icon={MessageCircle}
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <MetricCard
            label="Respostas"
            value={String(replied)}
            hint={
              replied > 0 ? "Contatos que responderam" : "Nenhuma resposta ainda"
            }
            icon={MessageSquareReply}
          />
          <MetricCard
            label="Limite do destinatário"
            value={String(frequencyCapped)}
            hint={
              frequencyCapped > 0
                ? "Meta limitou o marketing (erro 131049) — não é falha técnica"
                : "Nenhum bloqueio por frequência"
            }
            icon={ShieldAlert}
          />
          <MetricCard
            label="Falhas de envio"
            value={String(failed)}
            hint="Total de envios que falharam (inclui o limite ao lado)"
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
                  <TableHead>Enviada em</TableHead>
                  <TableHead>Entregue em</TableHead>
                  <TableHead>Lida em</TableHead>
                  <TableHead>Respondeu</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sends.map((send) => (
                  <TableRow key={send.id}>
                    <TableCell>
                      <p className="font-medium">{send.contactName}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatPhone(send.contactPhone)}
                        {send.contactCompany
                          ? ` · ${send.contactCompany}`
                          : ""}
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SendStatusBadge status={send.status} />
                        {send.status === "failed" && send.errorCode ? (
                          <Badge
                            variant={
                              send.errorCode === "131049" ? "warning" : "destructive"
                            }
                          >
                            {send.errorCode === "131049"
                              ? "Limite do destinatário"
                              : `Erro ${send.errorCode}`}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(send.sentAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(send.deliveredAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(send.readAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(send.repliedAt)}
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

  // ─── Canal de e-mail (comportamento original) ──────────────────────
  const sent = sends.filter((s) =>
    ["sent", "opened", "clicked"].includes(s.status)
  ).length;
  const opened = sends.filter((s) => s.openedAt !== null).length;
  const clicked = sends.filter((s) => s.clickedAt !== null).length;
  const bouncedHard = sends.filter((s) => s.bounceType === "hard").length;
  const bouncedSoft = sends.filter((s) => s.bounceType === "soft").length;
  const bounced = bouncedHard + bouncedSoft;
  const complained = sends.filter((s) => s.complainedAt !== null).length;

  return (
    <>
      {header}

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
