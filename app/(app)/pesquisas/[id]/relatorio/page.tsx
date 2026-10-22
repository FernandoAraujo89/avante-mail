"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, Eye, Gauge, Search, Users } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import {
  ArcoNps,
  BarrasHorizontais,
  Distribuicao,
  Funil,
  SimNao,
} from "@/components/pesquisas/graficos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import type { Agregado } from "@/lib/pesquisas/relatorio";
import type { RelatorioDto } from "@/lib/pesquisas/relatorio-db";
import { OBJETIVO_LABEL, TIPO_LABEL } from "@/lib/pesquisas/rotulos";

type ListaDto = { id: string; name: string; kind: string | null };

const TODAS = "__todas__";

export default function RelatorioPage() {
  const { id } = useParams<{ id: string }>();
  const [dados, setDados] = useState<RelatorioDto | null>(null);
  const [listas, setListas] = useState<ListaDto[]>([]);
  const [erro, setErro] = useState("");
  const [lista, setLista] = useState(TODAS);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [busca, setBusca] = useState("");

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (lista !== TODAS) p.set("lista", lista);
    if (de) p.set("de", de);
    if (ate) p.set("ate", ate);
    return p.toString();
  }, [lista, de, ate]);

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const [res, resL] = await Promise.all([
        fetch(`/api/pesquisas/${id}/relatorio${query ? `?${query}` : ""}`),
        fetch("/api/lists"),
      ]);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar o relatório.");
      setDados(json);
      if (resL.ok) setListas(((await resL.json()) as ListaDto[]).filter((l) => l.kind === null));
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, [id, query]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const r = dados?.relatorio;
  const buscaBaixa = busca.trim().toLowerCase();

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href={`/pesquisas/${id}`}>
            <ArrowLeft />
            Voltar para o acompanhamento
          </Link>
        </Button>
        <PageHeader
          title={dados ? `Relatório · ${dados.pesquisa.name}` : "Relatório"}
          description={dados ? OBJETIVO_LABEL[dados.pesquisa.objective] : undefined}
        >
          <Button variant="outline" asChild>
            <a href={`/api/pesquisas/${id}/relatorio?formato=csv${query ? `&${query}` : ""}`}>
              <Download />
              Exportar CSV
            </a>
          </Button>
        </PageHeader>
      </div>

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}

      <Card className="mb-6 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="filtro-lista">Lista</Label>
            <Select value={lista} onValueChange={setLista}>
              <SelectTrigger id="filtro-lista">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todos os convidados</SelectItem>
                {listas.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filtro-de">Convidados de</Label>
            <Input id="filtro-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filtro-ate">até</Label>
            <Input id="filtro-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
        </div>
      </Card>

      {!r ? (
        <Card>
          <p className="py-12 text-center text-sm text-muted-foreground">
            {erro ? "Sem dados." : "Carregando relatório..."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Convidados" value={String(r.funil.convidados)} icon={Users} />
            <MetricCard
              label="Abriram o link"
              value={String(r.funil.abriram)}
              icon={Eye}
              hint={r.funil.convidados ? `${Math.round((r.funil.abriram / r.funil.convidados) * 100)}% dos convidados` : undefined}
            />
            <MetricCard
              label="Concluíram"
              value={String(r.funil.concluiram)}
              icon={CheckCircle2}
              hint={r.funil.convidados ? `${Math.round((r.funil.concluiram / r.funil.convidados) * 100)}% dos convidados` : undefined}
            />
            <MetricCard
              label="NPS"
              value={r.nps ? String(r.nps.score) : "—"}
              icon={Gauge}
              hint={r.nps ? `${r.nps.n} resposta${r.nps.n === 1 ? "" : "s"} à pergunta-chave` : "sem pergunta do NPS"}
            />
          </div>

          <div className={r.nps ? "grid gap-6 lg:grid-cols-2" : "grid gap-6"}>
            <Card className="p-4 sm:p-5">
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Funil do convite</h2>
              <Funil funil={r.funil} />
            </Card>
            {r.nps ? (
              <Card className="p-4 sm:p-5">
                <h2 className="mb-3 text-sm font-semibold text-muted-foreground">NPS</h2>
                <ArcoNps nps={r.nps} />
              </Card>
            ) : null}
          </div>

          {r.perguntas.filter((p) => p.agregado.tipo !== "secao").length === 0 ? (
            <Card>
              <p className="py-10 text-center text-sm text-muted-foreground">
                A pesquisa ainda não tem perguntas.
              </p>
            </Card>
          ) : null}

          {r.perguntas.map(({ pergunta, agregado }, i) => {
            if (agregado.tipo === "secao") {
              return (
                <h2 key={pergunta.id} className="mt-2 text-base font-semibold">
                  {pergunta.label}
                </h2>
              );
            }
            return (
              <Card key={pergunta.id} className="p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">
                      <span className="text-muted-foreground">{i + 1}.</span> {pergunta.label}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {TIPO_LABEL[pergunta.type]} · {agregado.n} resposta{agregado.n === 1 ? "" : "s"}
                    </p>
                  </div>
                  {pergunta.arquivada ? <Badge variant="secondary">Arquivada</Badge> : null}
                  {pergunta.isNps ? <Badge variant="info">Pergunta do NPS</Badge> : null}
                </div>
                <Agregacao agregado={agregado} busca={buscaBaixa} onBusca={setBusca} busca_raw={busca} />
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

function Agregacao({
  agregado,
  busca,
  busca_raw,
  onBusca,
}: {
  agregado: Agregado;
  busca: string;
  busca_raw: string;
  onBusca: (v: string) => void;
}) {
  switch (agregado.tipo) {
    case "secao":
      return null;
    case "barras":
      return (
        <div className="grid gap-4">
          {agregado.n === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguém respondeu ainda.</p>
          ) : (
            <BarrasHorizontais itens={agregado.itens} />
          )}
          {agregado.outros.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Respostas em &quot;Outro&quot;</p>
              <ul className="grid gap-1 text-sm">
                {agregado.outros.map((o, i) => (
                  <li key={i}>
                    {o.texto} <span className="text-xs text-muted-foreground">— {o.contato}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      );
    case "escala":
      return agregado.n === 0 ? (
        <p className="text-sm text-muted-foreground">Ninguém respondeu ainda.</p>
      ) : (
        <div className="grid gap-3">
          <p className="text-sm">
            Média <strong>{agregado.media.toLocaleString("pt-BR")}</strong> (de {agregado.min} a {agregado.max})
          </p>
          <Distribuicao itens={agregado.distribuicao} nps={agregado.nps !== null} />
        </div>
      );
    case "simnao":
      return agregado.n === 0 ? (
        <p className="text-sm text-muted-foreground">Ninguém respondeu ainda.</p>
      ) : (
        <SimNao sim={agregado.sim} nao={agregado.nao} />
      );
    case "numero":
      return agregado.n === 0 ? (
        <p className="text-sm text-muted-foreground">Ninguém respondeu ainda.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {(
            [
              ["Média", agregado.media],
              ["Mediana", agregado.mediana],
              ["Mínimo", agregado.minimo],
              ["Máximo", agregado.maximo],
            ] as const
          ).map(([rotulo, valor]) => (
            <div key={rotulo}>
              <dt className="text-xs text-muted-foreground">{rotulo}</dt>
              <dd className="text-lg font-semibold tabular-nums">{valor.toLocaleString("pt-BR")}</dd>
            </div>
          ))}
        </dl>
      );
    case "texto": {
      const visiveis = agregado.respostas.filter(
        (r) => !busca || r.texto.toLowerCase().includes(busca) || r.contato.toLowerCase().includes(busca)
      );
      return (
        <div className="grid gap-3">
          {agregado.n > 3 ? (
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Buscar nas respostas"
                placeholder="Buscar nas respostas..."
                className="pl-9"
                value={busca_raw}
                onChange={(e) => onBusca(e.target.value)}
              />
            </div>
          ) : null}
          {agregado.n === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguém respondeu ainda.</p>
          ) : visiveis.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada encontrado.</p>
          ) : (
            <ul className="grid gap-2">
              {visiveis.map((r, i) => (
                <li key={i} className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
                  <p className="whitespace-pre-line">{r.texto}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.contato} · {formatDate(r.data)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
  }
}
