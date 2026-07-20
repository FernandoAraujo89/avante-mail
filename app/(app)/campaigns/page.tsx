import Link from "next/link";
import { BarChart2, Copy, Pencil, Plus } from "lucide-react";
import { desc, eq } from "drizzle-orm";

import { DeleteButton } from "@/components/delete-button";
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
import { campaigns, getDb, templates } from "@/lib/db";
import { formatDateTime, segmentsLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const db = getDb();

  const rows = await db
    .select({ campaign: campaigns, templateName: templates.name })
    .from(campaigns)
    .leftJoin(templates, eq(campaigns.templateId, templates.id))
    .orderBy(desc(campaigns.createdAt));

  return (
    <>
      <PageHeader
        title="Campanhas"
        description="Crie, edite e acompanhe os disparos para os parceiros."
      >
        <Button asChild>
          <Link href="/campaigns/new">
            <Plus />
            Nova campanha
          </Link>
        </Button>
      </PageHeader>

      <Card>
        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma campanha ainda. Clique em &quot;Nova campanha&quot; para
            começar.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Segmento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ campaign, templateName }) => {
                const editable =
                  campaign.status === "draft" ||
                  campaign.status === "scheduled";
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
                    <TableCell className="text-muted-foreground">
                      {segmentsLabel(campaign.segments)}
                    </TableCell>
                    <TableCell>
                      <CampaignStatusBadge status={campaign.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(campaign.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {editable ? (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/campaigns/new?id=${campaign.id}`}>
                              <Pencil />
                              Editar
                            </Link>
                          </Button>
                        ) : null}
                        <Button variant="ghost" size="sm" asChild>
                          <Link
                            href={`/campaigns/new?duplicate=${campaign.id}`}
                          >
                            <Copy />
                            Duplicar
                          </Link>
                        </Button>
                        {campaign.status !== "draft" ? (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/campaigns/${campaign.id}/report`}>
                              <BarChart2 />
                              Relatório
                            </Link>
                          </Button>
                        ) : null}
                        <DeleteButton
                          endpoint={`/api/campaigns/${campaign.id}`}
                          title="Excluir campanha"
                          description={
                            campaign.status === "sent"
                              ? `Tem certeza que deseja excluir "${campaign.name}"? O histórico de envios e as métricas desta campanha serão apagados junto. Esta ação não pode ser desfeita.`
                              : `Tem certeza que deseja excluir a campanha "${campaign.name}"? Esta ação não pode ser desfeita.`
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
    </>
  );
}
