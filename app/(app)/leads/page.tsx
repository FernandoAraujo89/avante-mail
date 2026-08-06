"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Gauge,
  ListChecks,
  Magnet,
  Search,
  Trash2,
  Webhook,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { BarraDeCalor } from "@/components/leads/barra-de-calor";
import {
  etapaLabel,
  FAIXAS,
  faixaInfo,
  type EtapaDto,
  type LeadDto,
} from "@/components/leads/estagios";
import {
  QUALIFICACOES,
  qualificacaoInfo,
} from "@/components/leads/qualificacoes";
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

interface Resposta {
  leads: LeadDto[];
  etapas: EtapaDto[];
  funil: Record<string, number>;
  qualificacoes: Record<string, number>;
  faixas: Record<string, number>;
  canais: { canal: string; total: number }[];
  config: {
    faixaQuente: number;
    faixaAquecido: number;
    faixaMorno: number;
    meiaVidaDias: number;
  };
}

export default function LeadsPage() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [estagio, setEstagio] = useState("todos");
  const [canal, setCanal] = useState("todos");
  const [faixa, setFaixa] = useState("todas");
  const [qualificacao, setQualificacao] = useState("todas");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [excluirAberto, setExcluirAberto] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  // Separado do erro: `carregar` começa com setErro(""), e o resultado da
  // exclusão sobrevive ao recarregamento que vem logo depois dela.
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const params = new URLSearchParams();
      if (busca.trim()) params.set("busca", busca.trim());
      if (estagio !== "todos") params.set("estagio", estagio);
      if (canal !== "todos") params.set("canal", canal);
      if (faixa !== "todas") params.set("faixa", faixa);
      if (qualificacao !== "todas") params.set("qualificacao", qualificacao);

      const res = await fetch(`/api/leads?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar os leads.");
      setDados(json);
      // A seleção não sobrevive ao filtro: marcado fora da tela é marcado que
      // ninguém vê, e a exclusão levaria junto quem sumiu da lista.
      setSelecionados(new Set());
    } catch (err) {
      setDados({
        leads: [],
        etapas: [],
        funil: {},
        qualificacoes: {},
        faixas: {},
        canais: [],
        config: {
          faixaQuente: 100,
          faixaAquecido: 50,
          faixaMorno: 20,
          meiaVidaDias: 30,
        },
      });
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, [busca, estagio, canal, faixa, qualificacao]);

  useEffect(() => {
    const timer = setTimeout(carregar, 300);
    return () => clearTimeout(timer);
  }, [carregar]);

  // O aviso da última exclusão some assim que a pessoa mexe nos filtros: senão
  // fica pendurado descrevendo uma ação que já saiu de vista.
  useEffect(() => {
    setAviso("");
  }, [busca, estagio, canal, faixa, qualificacao]);

  const leadsVisiveis = dados?.leads ?? [];
  const todosMarcados =
    leadsVisiveis.length > 0 &&
    leadsVisiveis.every((l) => selecionados.has(l.id));

  function alternarUm(id: string) {
    setSelecionados((antes) => {
      const agora = new Set(antes);
      if (agora.has(id)) agora.delete(id);
      else agora.add(id);
      return agora;
    });
  }

  function alternarTodos() {
    setSelecionados(() =>
      todosMarcados ? new Set() : new Set(leadsVisiveis.map((l) => l.id))
    );
  }

  async function excluirSelecionados() {
    if (selecionados.size === 0) return;
    setExcluindo(true);
    try {
      const res = await fetch("/api/leads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selecionados] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao excluir os leads.");
      setExcluirAberto(false);
      await carregar();
      // Recusa não é silêncio: se algum id não era lead, a tela diz, senão
      // "5 selecionados" viraria "3 excluídos" sem explicação nenhuma.
      const excluidos = `${json.excluidos} lead${json.excluidos === 1 ? "" : "s"} excluído${json.excluidos === 1 ? "" : "s"}.`;
      setAviso(
        json.recusados > 0
          ? `${excluidos} ${json.recusados} não ${json.recusados === 1 ? "era lead e foi mantido" : "eram leads e foram mantidos"}.`
          : excluidos
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setExcluirAberto(false);
    } finally {
      setExcluindo(false);
    }
  }

  const totalNoFunil = useMemo(
    () => Object.values(dados?.funil ?? {}).reduce((a, b) => a + b, 0),
    [dados]
  );

  const leads = dados?.leads ?? null;

  return (
    <>
      <PageHeader
        title="Gestão de leads"
        description="Nutrição de quem chegou por formulário, anúncio ou integração. Aqui a gente esquenta e mede o interesse; a venda acontece no Pipedrive."
      >
        <Button variant="outline" asChild>
          <Link href="/leads/pontuacao">
            <Gauge />
            Pontuação
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/leads/etapas">
            <ListChecks />
            Etapas do funil
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/leads/origens">
            <Webhook />
            Origens (webhook)
          </Link>
        </Button>
      </PageHeader>

      {/* O funil do Pipedrive, espelhado. A contagem é da base inteira, não do
          filtro — é o "onde estão meus leads", e encolher junto com a busca não
          responderia isso.

          As colunas vêm da tabela de etapas, não de uma constante: quem manda
          no funil é o comercial, e a tela precisa acompanhar sem deploy. */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
        {(dados?.etapas ?? [])
          // Etapa desativada só aparece se ainda tiver alguém dentro — senão a
          // tela mostraria coluna vazia de um processo que não existe mais.
          .filter((e) => e.active || (dados?.funil[e.slug] ?? 0) > 0)
          .map((e) => (
            <button
              key={e.slug}
              type="button"
              onClick={() => setEstagio(e.slug)}
              className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                estagio === e.slug
                  ? "border-primary bg-accent"
                  : "border-border bg-card hover:border-muted-foreground/40"
              }`}
            >
              <p className="text-xs text-muted-foreground">{e.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {dados?.funil[e.slug] ?? 0}
              </p>
              {e.stopsNurturing ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  encerra a nutrição
                </p>
              ) : null}
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
        <Select value={qualificacao} onValueChange={setQualificacao}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Qualificação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as qualificações</SelectItem>
            {QUALIFICACOES.map((q) => (
              <SelectItem key={q.valor} value={q.valor}>
                {q.rotulo} ({dados?.qualificacoes?.[q.valor] ?? 0})
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

      {aviso ? (
        <div className="mb-4 rounded-lg border bg-accent/50 px-4 py-3 text-sm">
          {aviso}
        </div>
      ) : null}

      {selecionados.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-accent/50 px-4 py-2">
          <span className="text-sm font-medium">
            {selecionados.size} lead{selecionados.size === 1 ? "" : "s"}{" "}
            selecionado{selecionados.size === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelecionados(new Set())}
            >
              Limpar seleção
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setExcluirAberto(true)}
            >
              <Trash2 />
              Excluir selecionados
            </Button>
          </div>
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
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos"
                    className="size-4 cursor-pointer accent-primary align-middle"
                    checked={todosMarcados}
                    onChange={alternarTodos}
                  />
                </TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Pontuação</TableHead>
                <TableHead>Qualificação</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Entrou em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="w-10">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${lead.name}`}
                      className="size-4 cursor-pointer accent-primary align-middle"
                      checked={selecionados.has(lead.id)}
                      onChange={() => alternarUm(lead.id)}
                    />
                  </TableCell>
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
                    {/* A barra dá a leitura de relance; o rótulo da faixa fica
                        embaixo porque é o que a pontuação e os gatilhos usam —
                        sem ele, a barra seria bonita e sem vocabulário. */}
                    <BarraDeCalor
                      score={lead.leadScore}
                      faixa={lead.leadScoreBand}
                      limiarMorno={dados?.config.faixaMorno ?? 20}
                      limiarAquecido={dados?.config.faixaAquecido ?? 50}
                      limiarQuente={dados?.config.faixaQuente ?? 100}
                    />
                    {faixaInfo(lead.leadScoreBand) ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {faixaInfo(lead.leadScoreBand)!.rotulo}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {qualificacaoInfo(lead.qualification) ? (
                      <Badge
                        variant={qualificacaoInfo(lead.qualification)!.variante}
                      >
                        {qualificacaoInfo(lead.qualification)!.rotulo}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        sem qualificação
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {etapaLabel(dados?.etapas ?? [], lead.stage)}
                    </span>
                    {lead.stageChangedAt ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        desde {formatDate(lead.stageChangedAt)}
                      </p>
                    ) : null}
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

      <Dialog open={excluirAberto} onOpenChange={setExcluirAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir leads</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">
                {selecionados.size} lead{selecionados.size === 1 ? "" : "s"}
              </span>{" "}
              {selecionados.size === 1 ? "será apagado" : "serão apagados"} da
              base, junto com a origem, a pontuação, a linha do tempo e o
              histórico de envios. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          {/* A porta de entrada continua aberta: se o agente reenviar esses
              contatos, eles voltam com ficha nova. Dizer aqui evita a conclusão
              errada de que a exclusão falhou. */}
          <p className="text-xs text-muted-foreground">
            Se o agente enviar esses contatos de novo pelo webhook, eles voltam
            a entrar como leads novos.
          </p>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExcluirAberto(false)}
              disabled={excluindo}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={excluirSelecionados}
              disabled={excluindo}
            >
              {excluindo ? "Excluindo..." : "Excluir selecionados"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
