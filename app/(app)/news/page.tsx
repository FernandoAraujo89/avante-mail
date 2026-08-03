import Link from "next/link";
import { BarChart2, Copy, Newspaper, Pencil, Plus, Users } from "lucide-react";
import { desc, eq, sql } from "drizzle-orm";

import { DeleteButton } from "@/components/delete-button";
import { NewsAudienceCard } from "@/components/news/news-audience-card";
import { PageHeader } from "@/components/page-header";
import { CampaignStatusBadge } from "@/components/status-badge";
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
import { campaigns, campaignSends, getDb, templates, users } from "@/lib/db";
import { campaignSenderLabel } from "@/lib/campaign-author";
import { formatBrl, formatDateTime, formatUsd } from "@/lib/format";
import { campaignCost } from "@/lib/pricing";
import { resolveNewsList } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const db = getDb();

  const [rows, audience] = await Promise.all([
    db
      .select({
        campaign: campaigns,
        templateName: templates.name,
        // Nome atual de quem disparou; a cópia do envio cobre a conta removida.
        senderName: users.name,
      })
      .from(campaigns)
      .leftJoin(templates, eq(campaigns.templateId, templates.id))
      .leftJoin(users, eq(campaigns.sentByUserId, users.id))
      .where(eq(campaigns.kind, "news"))
      .orderBy(desc(campaigns.createdAt)),
    resolveNewsList(),
  ]);

  // E-mails aceitos pelo SES por edição — base do custo.
  const chargeAgg = await db
    .select({
      campaignId: campaignSends.campaignId,
      chargeable: sql<number>`count(*) filter (where ${campaignSends.sentAt} is not null)`,
    })
    .from(campaignSends)
    .groupBy(campaignSends.campaignId);
  const chargeMap = new Map(
    chargeAgg.map((r) => [r.campaignId, Number(r.chargeable)])
  );

  return (
    <>
      <PageHeader
        title="Avante News"
        description="Boletim semanal enviado aos parceiros White Label Ativos. Registrado e reportado separadamente das campanhas."
      >
        {audience ? (
          <Button asChild>
            <Link href="/news/new">
              <Plus />
              Nova edição
            </Link>
          </Button>
        ) : (
          // Sem lista de destino não há como criar uma edição.
          <Button disabled>
            <Plus />
            Nova edição
          </Button>
        )}
      </PageHeader>

      <NewsAudienceCard initialAudience={audience} />

      <Card className="mt-6">
        {rows.length === 0 ? (
          <div className="py-12 text-center">
            <Newspaper className="mx-auto size-8 text-muted-foreground/60" />
            <p className="mt-3 font-medium">Nenhuma edição ainda</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Crie a primeira edição do Avante News a partir de um modelo salvo.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Edição</TableHead>
                <TableHead>Modelo de origem</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Custo</TableHead>
                <TableHead>Enviada por</TableHead>
                <TableHead>Enviada em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ campaign, templateName, senderName }) => {
                const editable =
                  campaign.status === "draft" || campaign.status === "scheduled";
                const cost = campaignCost({
                  channel: "email",
                  chargeable: chargeMap.get(campaign.id) ?? 0,
                });
                return (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <p className="font-medium">{campaign.name}</p>
                      <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">
                        {campaign.subject}
                      </p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {templateName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <CampaignStatusBadge status={campaign.status} />
                    </TableCell>
                    <TableCell>
                      {cost.chargeable === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <p className="font-medium">{formatUsd(cost.usd)}</p>
                          <p className="text-xs text-muted-foreground">
                            ≈ {formatBrl(cost.brl)}
                          </p>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {campaignSenderLabel(campaign, senderName) ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {campaign.sentAt
                        ? formatDateTime(campaign.sentAt)
                        : formatDateTime(campaign.scheduledAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {editable ? (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/news/new?id=${campaign.id}`}>
                              <Pencil />
                              Editar
                            </Link>
                          </Button>
                        ) : null}
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/news/new?duplicate=${campaign.id}`}>
                            <Copy />
                            Duplicar
                          </Link>
                        </Button>
                        {campaign.status !== "draft" ? (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/news/${campaign.id}/report`}>
                              <BarChart2 />
                              Relatório
                            </Link>
                          </Button>
                        ) : null}
                        <DeleteButton
                          endpoint={`/api/campaigns/${campaign.id}`}
                          title="Excluir edição"
                          description={
                            campaign.status === "sent"
                              ? `Tem certeza que deseja excluir "${campaign.name}"? O histórico de envios e as métricas desta edição serão apagados junto. Esta ação não pode ser desfeita.`
                              : `Tem certeza que deseja excluir a edição "${campaign.name}"? Esta ação não pode ser desfeita.`
                          }
                          iconOnly
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {rows.length > 0 ? (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="size-3.5" />
          Todas as edições vão para a lista de parceiros White Label Ativos — o
          destinatário não é escolhido por edição.
        </p>
      ) : null}
    </>
  );
}
