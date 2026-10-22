"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { SURVEY_OBJECTIVES, type SurveyInviteStatus } from "@/lib/db/schema";
import type { FrenteDoParceiro, LinhaDoPainel } from "@/lib/pesquisas/relatorio-db";
import { CONVITE_STATUS_LABEL, OBJETIVO_LABEL } from "@/lib/pesquisas/rotulos";

type ListaDto = { id: string; name: string; kind: string | null };

const TODAS = "__todas__";

const CONVITE_VARIANT: Record<SurveyInviteStatus, "secondary" | "info" | "warning" | "success" | "outline"> = {
  pending: "secondary",
  opened: "info",
  in_progress: "warning",
  completed: "success",
  closed: "outline",
};

function corDoNps(nota: number): string {
  return nota >= 9 ? "text-success-dark" : nota >= 7 ? "text-warning-dark" : "text-destructive";
}

export function CelulaDaFrente({ frente }: { frente: FrenteDoParceiro | null }) {
  if (!frente) {
    return <span className="text-xs text-muted-foreground">não convidado</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={CONVITE_VARIANT[frente.status]}>{CONVITE_STATUS_LABEL[frente.status]}</Badge>
      {frente.nps !== null ? (
        <span className={`text-sm font-semibold tabular-nums ${corDoNps(frente.nps)}`} title="Nota do NPS">
          {frente.nps}
        </span>
      ) : frente.status !== "completed" ? (
        <span className="text-xs tabular-nums text-muted-foreground">
          {frente.respondidas}/{frente.total}
        </span>
      ) : null}
    </div>
  );
}

export default function PainelDeParceirosPage() {
  const [linhas, setLinhas] = useState<LinhaDoPainel[] | null>(null);
  const [listas, setListas] = useState<ListaDto[]>([]);
  const [lista, setLista] = useState(TODAS);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");

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

  const visiveis = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (linhas ?? []).filter(
      (l) =>
        !b ||
        l.contact.name.toLowerCase().includes(b) ||
        (l.contact.company ?? "").toLowerCase().includes(b)
    );
  }, [linhas, busca]);

  return (
    <>
      <PageHeader
        title="Painel de parceiros"
        description="Cada parceiro nas três frentes: dados da empresa, satisfação e crescimento. A situação é a do convite mais recente."
      />

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}

      <Card className="mb-6 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
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
          <div className="grid gap-1.5">
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
        </div>
      </Card>

      <Card>
        {linhas === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Carregando painel...</p>
        ) : visiveis.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Users className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {linhas.length === 0 ? "Nenhum parceiro convidado ainda." : "Nada encontrado."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parceiro</TableHead>
                  {SURVEY_OBJECTIVES.map((o) => (
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
                      {l.contact.company ? (
                        <p className="text-xs text-muted-foreground">{l.contact.company}</p>
                      ) : null}
                    </TableCell>
                    {SURVEY_OBJECTIVES.map((o) => (
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
