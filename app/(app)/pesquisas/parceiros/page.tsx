"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EtapasDoParceiro } from "@/components/pesquisas/etapas-do-parceiro";
import { ProximoPassoDaRegua } from "@/components/pesquisas/regua";
import { SaudeBadge, TierBadge } from "@/components/pesquisas/saude";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PARTNER_TIERS, SURVEY_OBJECTIVES, type SurveyObjective } from "@/lib/db/schema";
import {
  ETAPA_LABEL,
  ETAPAS,
  etapaDoConvite,
  SAUDE_LABEL,
  SAUDES,
  TIER_LABEL,
  type Etapa,
  type Saude,
} from "@/lib/pesquisas/mapeamento";
import type { FrenteDoParceiro, LinhaDoPainel } from "@/lib/pesquisas/relatorio-db";
import { OBJETIVO_LABEL } from "@/lib/pesquisas/rotulos";

type ListaDto = { id: string; name: string; kind: string | null };

const TODAS = "__todas__";
const SEM = "__sem__";

function corDoNps(nota: number): string {
  return nota >= 9 ? "text-success-dark" : nota >= 7 ? "text-warning-dark" : "text-destructive";
}

/** A célula de uma fase: etapa (1 a 5), nota do NPS ou progresso, e o próximo passo da régua. */
export function CelulaDaFrente({ frente }: { frente: FrenteDoParceiro | null }) {
  if (!frente) {
    return <span className="text-xs text-muted-foreground">não convidado</span>;
  }
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <EtapasDoParceiro convite={frente} />
        {frente.nps !== null ? (
          <span className={`text-sm font-medium tabular-nums ${corDoNps(frente.nps)}`} title="Nota do NPS">
            {frente.nps}
          </span>
        ) : frente.status === "in_progress" || frente.status === "opened" ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {frente.respondidas}/{frente.total}
          </span>
        ) : null}
      </div>
      <ProximoPassoDaRegua convite={frente} />
    </div>
  );
}

type FiltroEtapa = Etapa | "encerrado" | "nao_convidado";

export default function PainelDeParceirosPage() {
  const [linhas, setLinhas] = useState<LinhaDoPainel[] | null>(null);
  const [listas, setListas] = useState<ListaDto[]>([]);
  const [lista, setLista] = useState(TODAS);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");

  // Filtros do projeto: fase + etapa, classificação, saúde e responsável.
  const [fase, setFase] = useState<SurveyObjective | typeof TODAS>(TODAS);
  const [etapa, setEtapa] = useState<FiltroEtapa | typeof TODAS>(TODAS);
  const [tier, setTier] = useState<string>(TODAS);
  const [saude, setSaude] = useState<Saude | typeof TODAS>(TODAS);
  const [responsavel, setResponsavel] = useState<string>(TODAS);

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const [res, resL] = await Promise.all([
        fetch(`/api/pesquisas/parceiros${lista !== TODAS ? `?lista=${lista}` : ""}`),
        fetch("/api/lists"),
      ]);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar o painel.");
      setLinhas(json);
      if (resL.ok) setListas(((await resL.json()) as ListaDto[]).filter((l) => l.kind === null));
    } catch (err) {
      setLinhas([]);
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, [lista]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const responsaveis = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const l of linhas ?? []) {
      if (l.perfil?.ownerUserId && l.perfil.ownerName) nomes.set(l.perfil.ownerUserId, l.perfil.ownerName);
    }
    return [...nomes.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [linhas]);

  const visiveis = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (linhas ?? []).filter((l) => {
      if (b && !l.contact.name.toLowerCase().includes(b) && !(l.contact.company ?? "").toLowerCase().includes(b)) {
        return false;
      }
      if (tier !== TODAS && (tier === SEM ? l.perfil?.tier : l.perfil?.tier !== tier)) return false;
      if (saude !== TODAS && l.saude !== saude) return false;
      if (responsavel !== TODAS && (responsavel === SEM ? l.perfil?.ownerUserId : l.perfil?.ownerUserId !== responsavel)) {
        return false;
      }
      if (etapa !== TODAS) {
        const fases = fase === TODAS ? SURVEY_OBJECTIVES : [fase];
        const casa = fases.some((o) => {
          const f = l.frentes[o];
          if (etapa === "nao_convidado") return !f;
          if (!f) return false;
          return etapaDoConvite(f).chave === etapa;
        });
        if (!casa) return false;
      }
      return true;
    });
  }, [linhas, busca, tier, saude, responsavel, fase, etapa]);

  const colunas = fase === TODAS ? SURVEY_OBJECTIVES : [fase];

  return (
    <>
      <PageHeader
        title="Painel de parceiros"
        description="Cada parceiro nas três fases do Mapeamento da Parceria: a etapa em que está, a saúde da parceria e o próximo passo da régua. A situação é a do convite mais recente."
      />

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}

      <Card className="mb-6 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="painel-lista">Lista</Label>
            <Select value={lista} onValueChange={setLista}>
              <SelectTrigger id="painel-lista">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Parceiros com algum convite</SelectItem>
                {listas.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 xl:col-span-2">
            <Label htmlFor="painel-busca">Buscar</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="painel-busca"
                className="pl-9"
                placeholder="Nome ou empresa"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="painel-fase">Fase</Label>
            <Select value={fase} onValueChange={(v) => setFase(v as SurveyObjective | typeof TODAS)}>
              <SelectTrigger id="painel-fase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas as fases</SelectItem>
                {SURVEY_OBJECTIVES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {OBJETIVO_LABEL[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="painel-etapa">Etapa</Label>
            <Select value={etapa} onValueChange={(v) => setEtapa(v as FiltroEtapa | typeof TODAS)}>
              <SelectTrigger id="painel-etapa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Qualquer etapa</SelectItem>
                {ETAPAS.map((e, i) => (
                  <SelectItem key={e} value={e}>
                    {i + 1} · {ETAPA_LABEL[e]}
                  </SelectItem>
                ))}
                <SelectItem value="encerrado">Sem resposta / encerrado</SelectItem>
                <SelectItem value="nao_convidado">Não convidado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="painel-saude">Saúde</Label>
            <Select value={saude} onValueChange={(v) => setSaude(v as Saude | typeof TODAS)}>
              <SelectTrigger id="painel-saude">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Qualquer saúde</SelectItem>
                {SAUDES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SAUDE_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="painel-tier">Classificação</Label>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger id="painel-tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Qualquer classificação</SelectItem>
                {PARTNER_TIERS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIER_LABEL[t]}
                  </SelectItem>
                ))}
                <SelectItem value={SEM}>Sem classificação</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="painel-responsavel">Responsável</Label>
            <Select value={responsavel} onValueChange={setResponsavel}>
              <SelectTrigger id="painel-responsavel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Qualquer responsável</SelectItem>
                {responsaveis.map(([id, nome]) => (
                  <SelectItem key={id} value={id}>
                    {nome}
                  </SelectItem>
                ))}
                <SelectItem value={SEM}>Sem responsável</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        {linhas === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Carregando painel...</p>
        ) : visiveis.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Users className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {linhas.length === 0 ? "Nenhum parceiro convidado ainda." : "Nada encontrado com esses filtros."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parceiro</TableHead>
                  <TableHead>Saúde</TableHead>
                  <TableHead>Classificação</TableHead>
                  <TableHead>Responsável</TableHead>
                  {colunas.map((o) => (
                    <TableHead key={o}>{OBJETIVO_LABEL[o]}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiveis.map((l) => (
                  <TableRow key={l.contact.id}>
                    <TableCell>
                      <Link href={`/pesquisas/parceiros/${l.contact.id}`} className="font-medium hover:underline">
                        {l.contact.name}
                      </Link>
                      {l.contact.company ? <p className="text-xs text-muted-foreground">{l.contact.company}</p> : null}
                    </TableCell>
                    <TableCell>
                      <SaudeBadge saude={l.saude} />
                      {l.alertasAbertos > 0 ? (
                        <p className="mt-1 text-xs text-destructive">
                          {l.alertasAbertos} alerta{l.alertasAbertos === 1 ? "" : "s"}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <TierBadge tier={l.perfil?.tier} />
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {l.perfil?.ownerName ?? <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    {colunas.map((o) => (
                      <TableCell key={o}>
                        <CelulaDaFrente frente={l.frentes[o]} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
