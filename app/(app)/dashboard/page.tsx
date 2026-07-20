import Link from "next/link";
import {
  MailOpen,
  MousePointerClick,
  Plus,
  Send,
  Users,
} from "lucide-react";
import { count, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { CampaignStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { campaigns, campaignSends, contacts, getDb } from "@/lib/db";
import { formatDateTime, formatPercent, segmentsLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const db = getDb();

  const [
    [{ value: totalContacts }],
    [{ value: sentCampaigns }],
    [{ value: delivered }],
    [{ value: opened }],
    [{ value: clicked }],
    recentCampaigns,
  ] = await Promise.all([
    db.select({ value: count() }).from(contacts),
    db
      .select({ value: count() })
      .from(campaigns)
      .where(eq(campaigns.status, "sent")),
    db
      .select({ value: count() })
      .from(campaignSends)
      .where(inArray(campaignSends.status, ["sent", "opened", "clicked"])),
    db
      .select({ value: count() })
      .from(campaignSends)
      .where(isNotNull(campaignSends.openedAt)),
    db
      .select({ value: count() })
      .from(campaignSends)
      .where(isNotNull(campaignSends.clickedAt)),
    db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(5),
  ]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Visão geral da comunicação com os parceiros."
      >
        <Button asChild>
          <Link href="/campaigns/new">
            <Plus />
            Nova campanha
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Contatos"
          value={String(totalContacts)}
          hint="Total na base"
          icon={Users}
        />
        <MetricCard
          label="Campanhas enviadas"
          value={String(sentCampaigns)}
          hint="Desde o início"
          icon={Send}
        />
        <MetricCard
          label="Taxa de abertura"
          value={formatPercent(opened, delivered)}
          hint={`${opened} aberturas em ${delivered} entregas`}
          icon={MailOpen}
        />
        <MetricCard
          label="Taxa de clique"
          value={formatPercent(clicked, delivered)}
          hint={`${clicked} cliques em ${delivered} entregas`}
          icon={MousePointerClick}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Últimas campanhas</CardTitle>
        </CardHeader>
        <CardContent>
          {recentCampaigns.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma campanha criada ainda. Comece criando a primeira.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {recentCampaigns.map((campaign) => (
                <li
                  key={campaign.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={
                        campaign.status === "draft"
                          ? `/campaigns/new?id=${campaign.id}`
                          : `/campaigns/${campaign.id}/report`
                      }
                      className="block truncate font-medium hover:text-primary"
                    >
                      {campaign.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {segmentsLabel(campaign.segments)} ·{" "}
                      {formatDateTime(campaign.createdAt)}
                    </p>
                  </div>
                  <CampaignStatusBadge status={campaign.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
