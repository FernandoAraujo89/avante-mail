"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BadgeCheck, Gauge, Reply } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { SaudeBadge } from "@/components/pesquisas/saude";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SAUDES, type Saude } from "@/lib/pesquisas/mapeamento";
import type { IndicadoresDto } from "@/lib/pesquisas/mapeamento-db";
import { OBJETIVO_LABEL } from "@/lib/pesquisas/rotulos";

type Dto = IndicadoresDto & { saude: Record<Saude, number>; parceiros: number };

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

/**
 * Os quatro indicadores da apresentação do projeto — taxa de resposta por
 * fase, base validada, NPS e alertas tratados em 48h — mais o mapa de saúde.
 */
export function IndicadoresDoProjeto() {
  const [dados, setDados] = useState<Dto | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    fetch("/api/pesquisas/indicadores")
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Erro ao carregar os indicadores.");
        if (ativo) setDados(json);
      })
      .catch((err) => {
        if (ativo) setErro(err instanceof Error ? err.message : String(err));
      });
    return () => {
      ativo = false;
    };
  }, []);

  const convidados = dados?.fases.reduce((s, f) => s + f.convidados, 0) ?? 0;
  const concluidos = dados?.fases.reduce((s, f) => s + f.concluidos, 0) ?? 0;
  const taxaGeral = convidados === 0 ? null : Math.round((concluidos / convidados) * 100);
  const abertos = dados?.alertas.abertos ?? 0;

  return (
    <section aria-labelledby="indicadores-projeto" className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="indicadores-projeto" className="text-lg font-medium">
            Mapeamento da Parceria
          </h2>
          <p className="text-sm text-muted-foreground">Como o projeto está indo, em todas as rodadas.</p>
        </div>
        <Button variant={abertos > 0 ? "default" : "outline"} size="sm" asChild>
          <Link href="/pesquisas/alertas">
            <AlertTriangle />
            Alertas de risco{abertos > 0 ? ` (${abertos})` : ""}
          </Link>
        </Button>
      </div>

      {erro ? (
        <Card className="p-4 text-sm text-destructive">{erro}</Card>
      ) : !dados ? (
        <Card>
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando indicadores...</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Taxa de resposta"
              value={pct(taxaGeral)}
              hint={dados.fases.map((f) => `${OBJETIVO_LABEL[f.objective].split(" · ")[0]} ${pct(f.taxa)}`).join(" · ")}
              icon={Reply}
            />
            <MetricCard
              label="Base validada"
              value={pct(dados.baseValidada)}
              hint={`Fase 1: ${dados.fases[0]?.validados ?? 0} validados de ${dados.fases[0]?.concluidos ?? 0} concluídos`}
              icon={BadgeCheck}
            />
            <MetricCard
              label="NPS da base"
              value={dados.nps ? String(dados.nps.score) : "—"}
              hint={
                dados.nps
                  ? `${dados.nps.n} respostas · ${dados.nps.promotores} promotores · ${dados.nps.detratores} detratores`
                  : "Ninguém concluiu a Fase 2 ainda"
              }
              icon={Gauge}
            />
            <MetricCard
              label="Alertas tratados em 48h"
              value={pct(dados.alertas.tratadosNoPrazo)}
              hint={
                dados.alertas.total === 0
                  ? "Nenhum alerta até agora"
                  : `${dados.alertas.abertos} em aberto · ${dados.alertas.vencidos} vencidos`
              }
              icon={AlertTriangle}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-muted-foreground">
              Mapa de saúde · {dados.parceiros} parceiro{dados.parceiros === 1 ? "" : "s"} com convite:
            </span>
            {SAUDES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <SaudeBadge saude={s} />
                <span className="tabular-nums">{dados.saude[s]}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
