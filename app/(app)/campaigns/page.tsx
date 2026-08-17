import Link from "next/link";
import { BarChart2, Copy, Pencil, Plus } from "lucide-react";
import { desc, eq, inArray, sql } from "drizzle-orm";

import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";
import { CampaignStatusBadge } from "@/components/status-badge";
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
  getDb,
  lists as listsTable,
  templates,
  users,
  whatsappTemplates,
  type Campaign,
} from "@/lib/db";
import { campaignSenderLabel } from "@/lib/campaign-author";
import { formatBrl, formatDateTime, formatUsd, listsLabel } from "@/lib/format";
import { campaignCost } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const db = getDb();

  // Só campanhas: o Avante News tem tela própria (/news).
  const rows = await db
    .select({
      campaign: campaigns,
      templateName: templates.name,
      // Nome atual de quem disparou; a cópia do envio cobre a conta removida.
      senderName: users.name,
    })
    .from(campaigns)
    .leftJoin(templates, eq(campaigns.templateId, templates.id))
    .leftJoin(users, eq(campaigns.sentByUserId, users.id))
    .where(eq(campaigns.kind, "campaign"))
    .orderBy(desc(campaigns.createdAt));

  const allLists = await db
    .select({ id: listsTable.id, name: listsTable.name })
    .from(listsTable);
  const listMap = new Map(allLists.map((l) => [l.id, l.name]));
  const listNames = (ids: string[] | null) =>
    (ids ?? []).map((id) => listMap.get(id) ?? id);

  // Unidades cobráveis por campanha: e-mails aceitos pelo SES (sentAt),
  // mensagens de WhatsApp entregues (deliveredAt) e SEGMENTOS de SMS que saíram
  // (sentAt — a Twilio cobra ao entregar à operadora). Uma query só.
  const chargeAgg = await db
    .select({
      campaignId: campaignSends.campaignId,
      sentChargeable: sql<number>`count(*) filter (where ${campaignSends.sentAt} is not null)`,
      waChargeable: sql<number>`count(*) filter (where ${campaignSends.deliveredAt} is not null)`,
      // Envio antigo, sem segmento gravado, conta como 1 — o piso de qualquer SMS.
      // Prefere o que a Twilio cobrou; cai na nossa contagem e, por último, no
      // piso de 1 segmento (linha anterior às colunas).
      smsSegments: sql<number>`coalesce(sum(coalesce(${campaignSends.smsSegmentsBilled}, ${campaignSends.smsSegments}, 1)) filter (where ${campaignSends.sentAt} is not null), 0)`,
    })
    .from(campaignSends)
    .groupBy(campaignSends.campaignId);
  const chargeMap = new Map(
    chargeAgg.map((r) => [
      r.campaignId,
      {
        sent: Number(r.sentChargeable),
        wa: Number(r.waChargeable),
        smsSegments: Number(r.smsSegments),
      },
    ])
  );

  // Categoria do modelo (define a tarifa) das campanhas de WhatsApp.
  const waTemplateIds = [
    ...new Set(
      rows
        .filter(
          (r) => r.campaign.channel === "whatsapp" && r.campaign.whatsappTemplateId
        )
        .map((r) => r.campaign.whatsappTemplateId as string)
    ),
  ];
  const categoryMap = new Map<string, string>();
  if (waTemplateIds.length > 0) {
    const cats = await db
      .select({
        id: whatsappTemplates.id,
        category: whatsappTemplates.category,
      })
      .from(whatsappTemplates)
      .where(inArray(whatsappTemplates.id, waTemplateIds));
    for (const c of cats) categoryMap.set(c.id, c.category);
  }

  const costFor = (campaign: Campaign) => {
    const counts = chargeMap.get(campaign.id) ?? {
      sent: 0,
      wa: 0,
      smsSegments: 0,
    };
    if (campaign.channel === "whatsapp") {
      return campaignCost({
        channel: "whatsapp",
        chargeable: counts.wa,
        whatsappCategory: campaign.whatsappTemplateId
          ? (categoryMap.get(campaign.whatsappTemplateId) ?? null)
          : null,
      });
    }
    if (campaign.channel === "sms") {
      // Mesma base do e-mail (envios com sentAt), preço em outra ordem de
      // grandeza: quem multiplica a tarifa são os segmentos, não os envios.
      return campaignCost({
        channel: "sms",
        chargeable: counts.sent,
        smsSegments: counts.smsSegments,
      });
    }
    return campaignCost({ channel: "email", chargeable: counts.sent });
  };

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
                <TableHead>Listas</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Custo</TableHead>
                <TableHead>Enviada por</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ campaign, templateName, senderName }) => {
                const editable =
                  campaign.status === "draft" ||
                  campaign.status === "scheduled";
                const cost = costFor(campaign);
                return (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{campaign.name}</p>
                        {campaign.channel === "whatsapp" ? (
                          <Badge variant="info">WhatsApp</Badge>
                        ) : null}
                        {campaign.channel === "sms" ? (
                          <Badge variant="info">SMS</Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">
                        {campaign.channel === "whatsapp"
                          ? "Campanha de WhatsApp"
                          : campaign.channel === "sms"
                            ? (campaign.smsBody ?? "Campanha de SMS")
                            : campaign.subject}
                      </p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {templateName ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {listsLabel(listNames(campaign.lists))}
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
