"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Gauge, Magnet, Search, Webhook } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
  ESTAGIOS,
  estagioLabel,
  FAIXAS,
  faixaInfo,
  type LeadDto,
} from "@/components/leads/estagios";
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

interface Resposta {
  leads: LeadDto[];
  funil: Record<string, number>;
  faixas: Record<string, number>;
  canais: { canal: string; total: number }[];
}

export default function LeadsPage() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [estagio, setEstagio] = useState("todos");
  const [canal, setCanal] = useState("todos");
  const [faixa, setFaixa] = useState("todas");

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const params = new URLSearchParams();
      if (busca.trim()) params.set("busca", busca.trim());
      if (estagio !== "todos") params.set("estagio", estagio);
      if (canal !== "todos") params.set("canal", canal);
      if (faixa !== "todas") params.set("faixa", faixa);

      const res = await fetch(`/api/leads?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar os leads.");
      setDados(json);
    } catch (err) {
      setDados({ leads: [], funil: {}, faixas: {}, canais: [] });
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, [busca, estagio, canal, faixa]);

  useEffect(() => {
    const timer = setTimeout(carregar, 300);
    return () => clearTimeout(timer);
  }, [carregar]);

  const totalNoFunil = useMemo(
    () => Object.values(dados?.funil ?? {}).reduce((a, b) => a + b, 0),
    [dados]
  );

  const leads = dados?.leads ?? null;

  return (
    <>
      <PageHeader
        title="Gestão de leads"
        description="Quem chegou por formulário, anúncio ou integração. Lead não recebe campanha de parceiro — é nutrido por automação até ser convertido."
      >
        <Button variant="outline" asChild>
          <Link href="/leads/pontuacao">
            <Gauge />
            Pontuação
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/leads/origens">
            <Webhook />
            Origens (webhook)
          </Link>
        </Button>
      </PageHeader>

      {/* Funil: a contagem é da base inteira, não do filtro — é o "onde estão
          meus leads", e encolher junto com a busca não responderia isso. */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <button
          type="button"
          onClick={() => setEstagio("todos")}
          className={`rounded-lg border px-4 py-3 text-left transition-colors ${
            estagio === "todos"
              ? "border-primary bg-accent"
              : "border-border bg-card hover:border-muted-foreground/40"
          }`}
        >
          <p className="text-xs text-muted-foreground">Todos</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{totalNoFunil}</p>
        </button>
        {ESTAGIOS.map((e) => (
          <button
            key={e.valor}
            type="button"
            onClick={() => setEstagio(e.valor)}
            className={`rounded-lg border px-4 py-3 text-left transition-colors ${
              estagio === e.valor
                ? "border-primary bg-accent"
                : "border-border bg-card hover:border-muted-foreground/40"
            }`}
          >
            <p className="text-xs text-muted-foreground">{e.rotulo}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {dados?.funil[e.valor] ?? 0}
            </p>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, e-mail, empresa ou telefone..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={faixa} onValueChange={setFaixa}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Pontuação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as pontuações</SelectItem>
            {FAIXAS.map((f) => (
              <SelectItem key={f.valor} value={f.valor}>
                {f.rotulo} ({dados?.faixas?.[f.valor] ?? 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={canal} onValueChange={setCanal}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Canal de origem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os canais</SelectItem>
            {(dados?.canais ?? []).map((c) => (
              <SelectItem key={c.canal} value={c.canal}>
                {c.canal} ({c.total})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}

      <Card>
        {leads === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando leads...
          </p>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Magnet className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {totalNoFunil === 0
                ? "Nenhum lead ainda. Ligue uma origem de webhook para começar a receber."
                : "Nenhum lead com os filtros atuais."}
            </p>
            {totalNoFunil === 0 ? (
              <Button variant="outline" asChild>
                <Link href="/leads/origens">
                  <Webhook />
                  Configurar origem
                </Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Pontuação</TableHead>
                <TableHead>Estágio</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Entrou em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-medium hover:underline"
                    >
                      {lead.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {lead.email}
                      {lead.phone ? ` · ${formatPhone(lead.phone)}` : ""}
                      {lead.company ? ` · ${lead.company}` : ""}
                    </p>
                    {!lead.subscribed ? (
                      <p className="mt-1 text-xs text-warning-dark">
                        Sem aceite de e-mail
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {/* Nota nula = o worker ainda não passou por este lead
                        (ele entrou há segundos). Mostrar "—" em vez de 0 evita
                        dizer que ele é frio sem ter contado nada. */}
                    {lead.leadScore === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="text-lg font-bold tabular-nums">
                          {lead.leadScore}
                        </span>
                        {faixaInfo(lead.leadScoreBand) ? (
                          <Badge variant={faixaInfo(lead.leadScoreBand)!.variante}>
                            {faixaInfo(lead.leadScoreBand)!.rotulo}
                          </Badge>
                        ) : null}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="warning">{estagioLabel(lead.stage)}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {lead.sourceChannel ?? "—"}
                    </span>
                    {lead.utmCampaign ? (
                      <p className="mt-0.5 max-w-56 truncate text-xs text-muted-foreground">
                        {lead.utmCampaign}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(lead.acquiredAt ?? lead.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {leads !== null && leads.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {leads.length} lead{leads.length === 1 ? "" : "s"} com os filtros
          atuais
        </p>
      ) : null}
    </>
  );
}
