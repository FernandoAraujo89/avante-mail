"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { CampaignTable } from "@/components/reports/campaign-table";
import { EngagementChart } from "@/components/reports/engagement-chart";
import { KpiTile } from "@/components/reports/kpi-tile";
import {
  ReportsFilters,
  type CampaignOption,
  type Preset,
} from "@/components/reports/reports-filters";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatInt, formatPctValue } from "@/lib/format";
import type { ReportResult } from "@/lib/reports";

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
  const [preset, setPreset] = useState<Preset>("30d");
  const [customFrom, setCustomFrom] = useState(daysAgoKey(29));
  const [customTo, setCustomTo] = useState(todayKey());
  const [campaignIds, setCampaignIds] = useState<string[]>([]);
  const [compare, setCompare] = useState(false);

  const [options, setOptions] = useState<CampaignOption[]>([]);
  const [data, setData] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);

  const { from, to } = useMemo(() => {
    if (preset === "7d") return { from: daysAgoKey(6), to: todayKey() };
    if (preset === "30d") return { from: daysAgoKey(29), to: todayKey() };
    return { from: customFrom, to: customTo };
  }, [preset, customFrom, customTo]);

  // Opções do filtro de campanha (todas as campanhas já disparadas).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/campaigns");
        const json = await res.json();
        if (res.ok && Array.isArray(json)) {
          setOptions(
            json
              .filter((c: { status: string }) =>
                ["sending", "sent", "scheduled"].includes(c.status)
              )
              .map((c: { id: string; name: string }) => ({
                id: c.id,
                name: c.name,
              }))
          );
        }
      } catch {
        // opções são um conforto; falha silenciosa
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to });
      if (campaignIds.length > 0) {
        params.set("campaignIds", campaignIds.join(","));
      }
      const res = await fetch(`/api/reports?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar métricas.");
      setData(json);
      // Se a campanha em foco saiu do resultado, volta para a visão geral.
      setFocusId((current) =>
        current && !json.seriesByCampaign[current] ? null : current
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, campaignIds]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const kpis = data?.kpis;
  const chartSeries =
    focusId && data?.seriesByCampaign[focusId]
      ? data.seriesByCampaign[focusId]
      : (data?.series ?? []);
  const focusName = focusId
    ? (data?.campaigns.find((c) => c.id === focusId)?.name ?? null)
    : null;

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Desempenho das campanhas de e-mail marketing."
      >
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Atualizar
        </Button>
      </PageHeader>

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
      />

      {error ? (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          Carregando métricas...
        </div>
      ) : kpis && kpis.sent.value === 0 && kpis.campaigns.value === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="font-medium">Sem dados no período</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Nenhuma campanha foi enviada entre {from.split("-").reverse().join("/")}{" "}
              e {to.split("-").reverse().join("/")}. Ajuste o período ou dispare
              uma campanha.
            </p>
          </CardContent>
        </Card>
      ) : kpis ? (
        <>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label="Campanhas"
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
                  Ver todas as campanhas
                </button>
              ) : null}
            </CardHeader>
            <CardContent>
              <EngagementChart series={chartSeries} />
            </CardContent>
          </Card>

          {/* Tabela */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Desempenho por campanha</CardTitle>
            </CardHeader>
            <CardContent>
              <CampaignTable
                rows={data.campaigns}
                selectedId={focusId}
                onSelect={setFocusId}
              />
            </CardContent>
          </Card>
        </>
      ) : null}

      {data ? (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Última atualização: {timeFmt.format(new Date(data.generatedAt))}
        </p>
      ) : null}
    </>
  );
}
