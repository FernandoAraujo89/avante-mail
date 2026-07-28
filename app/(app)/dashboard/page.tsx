import Link from "next/link";
import {
  MailOpen,
  MousePointerClick,
  Plus,
  Send,
  Users,
  Wallet,
} from "lucide-react";
import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { CampaignStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { formatMonthLabel, monthlyConsumption } from "@/lib/costs";
import {
  formatBrl,
  formatDateTime,
  formatPercent,
  formatUsd,
  listsLabel,
} from "@/lib/format";

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
    // Taxas de abertura/clique são do canal de e-mail: os envios de WhatsApp
    // (sem abertura/clique) não entram no denominador de entregas.
    db
      .select({ value: count() })
      .from(campaignSends)
      .innerJoin(campaigns, eq(campaignSends.campaignId, campaigns.id))
      .where(
        and(
          eq(campaigns.channel, "email"),
          inArray(campaignSends.status, ["sent", "opened", "clicked"])
        )
      ),
    db
      .select({ value: count() })
      .from(campaignSends)
      .innerJoin(campaigns, eq(campaignSends.campaignId, campaigns.id))
      .where(
        and(eq(campaigns.channel, "email"), isNotNull(campaignSends.openedAt))
      ),
    db
      .select({ value: count() })
      .from(campaignSends)
      .innerJoin(campaigns, eq(campaignSends.campaignId, campaigns.id))
      .where(
        and(eq(campaigns.channel, "email"), isNotNull(campaignSends.clickedAt))
      ),
    db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(5),
  ]);

  const allLists = await db
    .select({ id: listsTable.id, name: listsTable.name })
    .from(listsTable);
  const listMap = new Map(allLists.map((l) => [l.id, l.name]));
  const listNames = (ids: string[] | null) =>
    (ids ?? []).map((id) => listMap.get(id) ?? id);

  // Consumo consolidado (US$/R$) por mês e canal — últimos 6 meses.
  const consumption = await monthlyConsumption(6);
  const costCell = (usd: number, brl: number, strong = false) => (
    <div>
      <p className={strong ? "font-semibold" : "font-medium"}>
        {formatUsd(usd)}
      </p>
      <p className="text-xs text-muted-foreground">{formatBrl(brl)}</p>
    </div>
  );

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
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-4 text-primary" />
            Consumo por mês
          </CardTitle>
          <CardDescription>
            AWS SES (e-mail) + WhatsApp (Meta). Cobrado em US$; R$ convertido ao
            câmbio de {formatBrl(consumption.rate)}/US$.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {consumption.months.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum consumo registrado ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mês</TableHead>
                    <TableHead className="text-right">E-mail</TableHead>
                    <TableHead className="text-right">WhatsApp</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consumption.months.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="font-medium">
                        {formatMonthLabel(m.month)}
                      </TableCell>
                      <TableCell className="text-right">
                        {costCell(m.emailUsd, m.emailBrl)}
                      </TableCell>
                      <TableCell className="text-right">
                        {costCell(m.whatsappUsd, m.whatsappBrl)}
                      </TableCell>
                      <TableCell className="text-right">
                        {costCell(m.totalUsd, m.totalBrl, true)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-border">
                    <TableCell className="font-semibold">
                      Total ({consumption.months.length}{" "}
                      {consumption.months.length === 1 ? "mês" : "meses"})
                    </TableCell>
                    <TableCell className="text-right">
                      {costCell(
                        consumption.emailUsd,
                        consumption.emailUsd * consumption.rate
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {costCell(
                        consumption.whatsappUsd,
                        consumption.whatsappUsd * consumption.rate
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {costCell(consumption.totalUsd, consumption.totalBrl, true)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

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
                      {listsLabel(listNames(campaign.lists))} ·{" "}
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
