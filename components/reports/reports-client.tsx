"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, MessageCircle, Newspaper, RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { CampaignTable } from "@/components/reports/campaign-table";
import { EngagementChart } from "@/components/reports/engagement-chart";
import { KpiTile } from "@/components/reports/kpi-tile";
import {
  ReportsFilters,
  type CampaignOption,
  type Preset,
} from "@/components/reports/reports-filters";
import { WhatsAppTable } from "@/components/reports/whatsapp-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatInt, formatPctValue } from "@/lib/format";
import type { ReportResult, WhatsAppReportResult } from "@/lib/reports";
import { cn } from "@/lib/utils";

// Os três conjuntos de dados nunca se misturam: cada escopo tem sua própria
// origem (campanhas de e-mail, Avante News, WhatsApp) e suas próprias métricas.
type Scope = "campaigns" | "news" | "whatsapp";

const SCOPES: {
  key: Scope;
  label: string;
  icon: typeof Mail;
  description: string;
  /** De onde vêm as opções do filtro de campanha/edição. */
  optionsEndpoint: string;
  optionChannel?: "email" | "whatsapp";
}[] = [
  {
    key: "campaigns",
    label: "Campanhas de e-mail",
    icon: Mail,
    description: "Desempenho das campanhas de e-mail marketing.",
    optionsEndpoint: "/api/campaigns",
    optionChannel: "email",
  },
  {
    key: "news",
    label: "Avante News",
    icon: Newspaper,
    description:
      "Desempenho do boletim semanal enviado aos parceiros White Label Ativos.",
    optionsEndpoint: "/api/news",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    description: "Desempenho das campanhas enviadas pela Cloud API da Meta.",
    optionsEndpoint: "/api/campaigns",
    optionChannel: "whatsapp",
  },
];

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

function daysAgoKey(days: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

const timeFmt = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function ReportsClient() {
  const [scope, setScope] = useState<Scope>("campaigns");
  const [preset, setPreset] = useState<Preset>("30d");
  const [customFrom, setCustomFrom] = useState(daysAgoKey(29));
  const [customTo, setCustomTo] = useState(todayKey());
  const [campaignIds, setCampaignIds] = useState<string[]>([]);
  const [compare, setCompare] = useState(false);

  const [options, setOptions] = useState<CampaignOption[]>([]);
  const [data, setData] = useState<ReportResult | null>(null);
  const [waData, setWaData] = useState<WhatsAppReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);

  const config = SCOPES.find((s) => s.key === scope) ?? SCOPES[0];

  const { from, to } = useMemo(() => {
    if (preset === "7d") return { from: daysAgoKey(6), to: todayKey() };
    if (preset === "30d") return { from: daysAgoKey(29), to: todayKey() };
    return { from: customFrom, to: customTo };
  }, [preset, customFrom, customTo]);

  // Opções do filtro: só os disparos já feitos do escopo atual.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(config.optionsEndpoint);
        const json = await res.json();
        if (cancelled || !res.ok || !Array.isArray(json)) return;
        setOptions(
          json
            .filter(
              (c: { status: string; channel?: string }) =>
                ["sending", "sent", "scheduled"].includes(c.status) &&
                (!config.optionChannel || c.channel === config.optionChannel)
            )
            .map((c: { id: string; name: string }) => ({
              id: c.id,
              name: c.name,
            }))
        );
      } catch {
        // opções são um conforto; falha silenciosa
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config.optionsEndpoint, config.optionChannel]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to, scope });
      if (campaignIds.length > 0) {
        params.set("campaignIds", campaignIds.join(","));
      }
      const res = await fetch(`/api/reports?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar métricas.");
      if (scope === "whatsapp") {
        setWaData(json);
        setData(null);
      } else {
        setData(json);
        setWaData(null);
      }
      // Se o item em foco saiu do resultado, volta para a visão geral.
      setFocusId((current) =>
        current && !json.seriesByCampaign[current] ? null : current
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
      setWaData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, campaignIds, scope]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  function changeScope(next: Scope) {
    if (next === scope) return;
    setScope(next);
    setCampaignIds([]);
    setFocusId(null);
    setOptions([]);
  }

  const generatedAt = data?.generatedAt ?? waData?.generatedAt ?? null;

  const scopeTabs = (
    <div className="mb-6 flex flex-wrap items-center gap-1 rounded-lg border border-border p-1">
      {SCOPES.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => changeScope(s.key)}
          aria-pressed={scope === s.key}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
            scope === s.key
              ? "bg-primary/10 font-medium text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <s.icon className="size-4" />
          {s.label}
        </button>
      ))}
    </div>
  );

  const filters = (
    <ReportsFilters
      preset={preset}
      onPreset={setPreset}
      from={from}
      to={to}
      onCustomFrom={setCustomFrom}
      onCustomTo={setCustomTo}
      options={options}
      selectedIds={campaignIds}
      onToggleCampaign={(id) =>
        setCampaignIds((cur) =>
          cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
        )
      }
      onClearCampaigns={() => setCampaignIds([])}
      compare={compare}
      onCompare={setCompare}
      label={scope === "news" ? "Edição" : "Campanha"}
      allLabel={scope === "news" ? "Todas as edições" : "Todas as campanhas"}
    />
  );

  const header = (
    <>
      <PageHeader title="Relatórios" description={config.description}>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Atualizar
        </Button>
      </PageHeader>

      {scopeTabs}
      {filters}

      {error ? (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}
    </>
  );

  const emptyState = (
    <Card>
      <CardContent className="py-16 text-center">
        <p className="font-medium">Sem dados no período</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {scope === "news"
            ? "Nenhuma edição do Avante News foi enviada"
            : scope === "whatsapp"
              ? "Nenhuma campanha de WhatsApp foi disparada"
              : "Nenhuma campanha de e-mail foi enviada"}{" "}
          entre {from.split("-").reverse().join("/")} e{" "}
          {to.split("-").reverse().join("/")}. Ajuste o período.
        </p>
      </CardContent>
    </Card>
  );

  const footer = generatedAt ? (
    <p className="mt-6 text-center text-xs text-muted-foreground">
      Última atualização: {timeFmt.format(new Date(generatedAt))}
    </p>
  ) : null;

  // ─── WhatsApp ────────────────────────────────────────────────────────
  if (scope === "whatsapp") {
    const kpis = waData?.kpis;
    const series =
      focusId && waData?.seriesByCampaign[focusId]
        ? waData.seriesByCampaign[focusId]
        : (waData?.series ?? []);
    const focusName = focusId
      ? (waData?.campaigns.find((c) => c.id === focusId)?.name ?? null)
      : null;

    return (
      <>
        {header}

        {loading && !waData ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            Carregando métricas...
          </div>
        ) : kpis && kpis.campaigns.value === 0 ? (
          emptyState
        ) : kpis ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile
                label="Campanhas"
                value={formatInt(kpis.campaigns.value)}
                current={kpis.campaigns.value}
                previous={kpis.campaigns.previous}
                showComparison={compare}
              />
              <KpiTile
                label="Mensagens enviadas"
                value={formatInt(kpis.sent.value)}
                current={kpis.sent.value}
                previous={kpis.sent.previous}
                showComparison={compare}
              />
              <KpiTile
                label="Entregues"
                value={formatInt(kpis.delivered.value)}
                sub={formatPctValue(kpis.delivered.rate)}
                current={kpis.delivered.value}
                previous={kpis.delivered.previous}
                showComparison={compare}
              />
              <KpiTile
                label="Lidas"
                value={formatInt(kpis.read.value)}
                sub={formatPctValue(kpis.read.rate)}
                current={kpis.read.value}
                previous={kpis.read.previous}
                showComparison={compare}
              />
              <KpiTile
                label="Taxa de entrega"
                value={formatPctValue(kpis.delivered.rate)}
                current={kpis.delivered.rate}
                previous={kpis.delivered.ratePrevious}
                kind="pp"
                showComparison={compare}
              />
              <KpiTile
                label="Taxa de leitura"
                value={formatPctValue(kpis.read.rate)}
                current={kpis.read.rate}
                previous={kpis.read.ratePrevious}
                kind="pp"
                showComparison={compare}
              />
              <KpiTile
                label="Respostas"
                value={formatInt(kpis.replied.value)}
                sub={formatPctValue(kpis.replied.rate)}
                current={kpis.replied.value}
                previous={kpis.replied.previous}
                showComparison={compare}
              />
              <KpiTile
                label="Falhas de envio"
                value={formatInt(kpis.failed.value)}
                sub={
                  kpis.frequencyCapped.value > 0
                    ? `${formatInt(kpis.frequencyCapped.value)} por limite`
                    : undefined
                }
                current={kpis.failed.value}
                previous={kpis.failed.previous}
                invert
                showComparison={compare}
              />
            </div>

            <Card className="mt-6">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>
                  Entregas e leituras ao longo do tempo
                  {focusName ? (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      · {focusName}
                    </span>
                  ) : null}
                </CardTitle>
                {focusId ? (
                  <button
                    type="button"
                    onClick={() => setFocusId(null)}
                    className="text-xs text-primary hover:underline"
                  >
                    Ver todas as campanhas
                  </button>
                ) : null}
              </CardHeader>
              <CardContent>
                <EngagementChart
                  series={series.map((p) => ({
                    date: p.date,
                    primary: p.delivered,
                    secondary: p.read,
                  }))}
                  labels={{ primary: "Entregues", secondary: "Lidas" }}
                />
              </CardContent>
            </Card>

            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Desempenho por campanha</CardTitle>
              </CardHeader>
              <CardContent>
                <WhatsAppTable
                  rows={waData?.campaigns ?? []}
                  selectedId={focusId}
                  onSelect={setFocusId}
                />
              </CardContent>
            </Card>
          </>
        ) : null}

        {footer}
      </>
    );
  }

  // ─── E-mail: campanhas e Avante News ─────────────────────────────────
  const kpis = data?.kpis;
  const chartSeries =
    focusId && data?.seriesByCampaign[focusId]
      ? data.seriesByCampaign[focusId]
      : (data?.series ?? []);
  const focusName = focusId
    ? (data?.campaigns.find((c) => c.id === focusId)?.name ?? null)
    : null;
  const isNews = scope === "news";

  return (
    <>
      {header}

      {loading && !data ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          Carregando métricas...
        </div>
      ) : kpis && kpis.sent.value === 0 && kpis.campaigns.value === 0 ? (
        emptyState
      ) : kpis ? (
        <>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label={isNews ? "Edições enviadas" : "Campanhas"}
              value={formatInt(kpis.campaigns.value)}
              current={kpis.campaigns.value}
              previous={kpis.campaigns.previous}
              showComparison={compare}
            />
            <KpiTile
              label="E-mails enviados"
              value={formatInt(kpis.sent.value)}
              sub={`${formatInt(kpis.delivered.value)} entregues`}
              current={kpis.sent.value}
              previous={kpis.sent.previous}
              showComparison={compare}
            />
            <KpiTile
              label="Taxa de abertura"
              value={formatPctValue(kpis.openRate.value)}
              sub={`${formatInt(kpis.openRate.opened)} aberturas`}
              current={kpis.openRate.value}
              previous={kpis.openRate.previous}
              kind="pp"
              showComparison={compare}
            />
            <KpiTile
              label="Taxa de cliques"
              value={formatPctValue(kpis.clickRate.value)}
              sub={`${formatInt(kpis.clickRate.clicked)} cliques`}
              current={kpis.clickRate.value}
              previous={kpis.clickRate.previous}
              kind="pp"
              showComparison={compare}
            />
            <KpiTile
              label="Cliques por abertura (CTOR)"
              value={formatPctValue(kpis.ctor.value)}
              current={kpis.ctor.value}
              previous={kpis.ctor.previous}
              kind="pp"
              showComparison={compare}
            />
            <KpiTile
              label="Devoluções"
              value={formatInt(kpis.bounces.value)}
              sub={formatPctValue(kpis.bounces.rate)}
              current={kpis.bounces.value}
              previous={kpis.bounces.previous}
              invert
              showComparison={compare}
            />
            <KpiTile
              label="Reclamações de spam"
              value={formatInt(kpis.complaints.value)}
              sub={formatPctValue(kpis.complaints.rate)}
              current={kpis.complaints.value}
              previous={kpis.complaints.previous}
              invert
              showComparison={compare}
            />
            <KpiTile
              label="Inscrições canceladas"
              value={formatInt(kpis.unsubscribes.value)}
              sub={formatPctValue(kpis.unsubscribes.rate)}
              current={kpis.unsubscribes.value}
              previous={kpis.unsubscribes.previous}
              invert
              showComparison={compare}
            />
          </div>

          {/* Gráfico */}
          <Card className="mt-6">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>
                Engajamento ao longo do tempo
                {focusName ? (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    · {focusName}
                  </span>
                ) : null}
              </CardTitle>
              {focusId ? (
                <button
                  type="button"
                  onClick={() => setFocusId(null)}
                  className="text-xs text-primary hover:underline"
                >
                  {isNews ? "Ver todas as edições" : "Ver todas as campanhas"}
                </button>
              ) : null}
            </CardHeader>
            <CardContent>
              <EngagementChart
                series={chartSeries.map((p) => ({
                  date: p.date,
                  primary: p.opened,
                  secondary: p.clicked,
                }))}
              />
            </CardContent>
          </Card>

          {/* Tabela */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>
                {isNews ? "Desempenho por edição" : "Desempenho por campanha"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CampaignTable
                rows={data?.campaigns ?? []}
                selectedId={focusId}
                onSelect={setFocusId}
                nameLabel={isNews ? "Edição" : "Campanha"}
              />
            </CardContent>
          </Card>
        </>
      ) : null}

      {footer}
    </>
  );
}
