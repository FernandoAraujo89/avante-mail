"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  BellRing,
  CheckCircle2,
  Copy,
  Eye,
  Lock,
  LockOpen,
  Pencil,
  Send,
  UserPlus,
  Users,
} from "lucide-react";

import { MetricCard } from "@/components/metric-card";
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
import {
  Table,
  TableActionsCell,
  TableActionsHead,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SurveyInviteStatus, SurveyStatus } from "@/lib/db/schema";
import { formatDate, formatDateTime } from "@/lib/format";
import type { ConviteDto, ResultadoConvite, ResultadoLembrete } from "@/lib/pesquisas/envios";
import type { LimitesDeLembrete } from "@/lib/pesquisas/lembretes";
import {
  CONVITE_STATUS_LABEL,
  OBJETIVO_LABEL,
  STATUS_LABEL,
  type PesquisaDto,
} from "@/lib/pesquisas/rotulos";

type ListaDto = { id: string; name: string; kind: string | null; contactCount: number };

const STATUS_VARIANT: Record<SurveyStatus, "secondary" | "success" | "warning"> = {
  draft: "secondary",
  active: "success",
  closed: "warning",
};

const CONVITE_VARIANT: Record<
  SurveyInviteStatus,
  "secondary" | "info" | "warning" | "success" | "outline"
> = {
  pending: "secondary",
  opened: "info",
  in_progress: "warning",
  completed: "success",
  closed: "outline",
};

const ENVIO_STATUS_LABEL: Record<string, string> = {
  pending: "na fila",
  sent: "enviado",
  delivered: "entregue",
  opened: "aberto",
  clicked: "clicou",
  read: "lido",
  failed: "falhou",
  bounced: "devolvido",
  complained: "reclamou",
};

const PENDENTES: SurveyInviteStatus[] = ["pending", "opened", "in_progress"];

type Filtro = "todos" | "pendentes" | "completed" | "closed";

export default function AcompanhamentoPage() {
  const { id } = useParams<{ id: string }>();

  const [pesquisa, setPesquisa] = useState<PesquisaDto | null>(null);
  const [convites, setConvites] = useState<ConviteDto[] | null>(null);
  const [listas, setListas] = useState<ListaDto[]>([]);
  const [limites, setLimites] = useState<LimitesDeLembrete | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const [convidarAberto, setConvidarAberto] = useState(false);
  const [listasEscolhidas, setListasEscolhidas] = useState<string[]>([]);
  const [porEmail, setPorEmail] = useState(true);
  const [lembrarAberto, setLembrarAberto] = useState(false);
  const [escopoLembrete, setEscopoLembrete] = useState<"selecionados" | "pendentes">("pendentes");
  const [enviando, setEnviando] = useState(false);
  const [formError, setFormError] = useState("");

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const [resP, resC, resL, resLim] = await Promise.all([
        fetch(`/api/pesquisas/${id}`),
        fetch(`/api/pesquisas/${id}/convites`),
        fetch("/api/lists"),
        fetch(`/api/pesquisas/${id}/convites/lembrar`),
      ]);
      const jsonP = await resP.json();
      if (!resP.ok) throw new Error(jsonP.error ?? "Erro ao carregar a pesquisa.");
      setPesquisa(jsonP);
      const jsonC = await resC.json();
      if (!resC.ok) throw new Error(jsonC.error ?? "Erro ao carregar os convites.");
      setConvites(jsonC);
      if (resL.ok) setListas(((await resL.json()) as ListaDto[]).filter((l) => l.kind === null));
      if (resLim.ok) setLimites(await resLim.json());
    } catch (err) {
      setConvites([]);
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const visiveis = useMemo(
    () =>
      (convites ?? []).filter((c) =>
        filtro === "todos"
          ? true
          : filtro === "pendentes"
            ? PENDENTES.includes(c.status)
            : c.status === filtro
      ),
    [convites, filtro]
  );

  const contagem = useMemo(() => {
    const todos = convites ?? [];
    return {
      convidados: todos.length,
      abriram: todos.filter((c) => c.openedAt || c.startedAt || c.completedAt).length,
      respondendo: todos.filter((c) => c.status === "in_progress").length,
      concluidas: todos.filter((c) => c.status === "completed").length,
      pendentes: todos.filter((c) => PENDENTES.includes(c.status)).length,
    };
  }, [convites]);

  const ativa = pesquisa?.status === "active";

  function alternarSelecao(conviteId: string) {
    setSelecionados((s) => {
      const copia = new Set(s);
      if (copia.has(conviteId)) copia.delete(conviteId);
      else copia.add(conviteId);
      return copia;
    });
  }

  async function copiarLink(c: ConviteDto) {
    try {
      await navigator.clipboard.writeText(c.link);
      setAviso(`Link de ${c.contact.name} copiado.`);
    } catch {
      setAviso(`Link de ${c.contact.name}: ${c.link}`);
    }
  }

  async function acaoNoConvite(c: ConviteDto, acao: "encerrar" | "reabrir") {
    setErro("");
    setAviso("");
    try {
      const res = await fetch(`/api/pesquisas/${id}/convites/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível atualizar o convite.");
      setAviso(acao === "encerrar" ? `Convite de ${c.contact.name} encerrado.` : `Convite de ${c.contact.name} reaberto.`);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }

  function abrirConvidar() {
    setListasEscolhidas([]);
    setPorEmail(true);
    setFormError("");
    setConvidarAberto(true);
  }

  async function convidar() {
    setEnviando(true);
    setFormError("");
    try {
      const res = await fetch(`/api/pesquisas/${id}/convites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listIds: listasEscolhidas, channels: porEmail ? ["email"] : [] }),
      });
      const json = (await res.json()) as ResultadoConvite & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Não foi possível convidar.");
      const partes = [
        `${json.convidados} convidado${json.convidados === 1 ? "" : "s"}`,
        json.enfileirados ? `${json.enfileirados} e-mail${json.enfileirados === 1 ? "" : "s"} na fila` : null,
        json.semEndereco ? `${json.semEndereco} sem e-mail (só o link)` : null,
        json.jaConvidados ? `${json.jaConvidados} já tinha${json.jaConvidados === 1 ? "" : "m"} convite aberto` : null,
      ].filter(Boolean);
      setAviso(partes.join(" · ") + ".");
      setConvidarAberto(false);
      await carregar();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  function abrirLembrar() {
    setEscopoLembrete(selecionados.size > 0 ? "selecionados" : "pendentes");
    setFormError("");
    setLembrarAberto(true);
  }

  async function lembrar() {
    setEnviando(true);
    setFormError("");
    try {
      const res = await fetch(`/api/pesquisas/${id}/convites/lembrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          escopoLembrete === "pendentes"
            ? { todosPendentes: true, channels: ["email"] }
            : { inviteIds: [...selecionados], channels: ["email"] }
        ),
      });
      const json = (await res.json()) as ResultadoLembrete & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Não foi possível lembrar.");
      const partes = [
        `${json.lembrados} lembrete${json.lembrados === 1 ? "" : "s"} na fila`,
        json.pulados.concluido ? `${json.pulados.concluido} já concluíram` : null,
        json.pulados.limite ? `${json.pulados.limite} no teto de lembretes` : null,
        json.pulados.intervalo ? `${json.pulados.intervalo} lembrado${json.pulados.intervalo === 1 ? "" : "s"} há pouco` : null,
        json.pulados.semEndereco ? `${json.pulados.semEndereco} sem e-mail` : null,
      ].filter(Boolean);
      setAviso(partes.join(" · ") + ".");
      setLembrarAberto(false);
      setSelecionados(new Set());
      await carregar();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/pesquisas">
            <ArrowLeft />
            Voltar para pesquisas
          </Link>
        </Button>
        {pesquisa ? (
          <PageHeader
            title={pesquisa.name}
            description={`${OBJETIVO_LABEL[pesquisa.objective]} · ${pesquisa.questionCount} pergunta${
              pesquisa.questionCount === 1 ? "" : "s"
            }${pesquisa.createdByName ? ` · criada por ${pesquisa.createdByName}` : ""}`}
          >
            <Badge variant={STATUS_VARIANT[pesquisa.status]}>{STATUS_LABEL[pesquisa.status]}</Badge>
            <Button variant="outline" asChild>
              <Link href={`/pesquisas/${id}/editar`}>
                <Pencil />
                Perguntas
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/pesquisas/${id}/relatorio`}>
                <BarChart3 />
                Relatório
              </Link>
            </Button>
            <Button
              variant="outline"
              disabled={!ativa || contagem.pendentes === 0}
              title={!ativa ? "A pesquisa precisa estar ativa." : undefined}
              onClick={abrirLembrar}
            >
              <BellRing />
              Lembrar
            </Button>
            <Button
              disabled={!ativa}
              title={!ativa ? "Ative a pesquisa (em Perguntas) para convidar." : undefined}
              onClick={abrirConvidar}
            >
              <UserPlus />
              Convidar parceiros
            </Button>
          </PageHeader>
        ) : null}
      </div>

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}
      {aviso ? (
        <div className="mb-4 rounded-lg border border-success-dark/30 bg-success-light/20 px-4 py-3 text-sm break-all text-success-dark">
          {aviso}
        </div>
      ) : null}
      {pesquisa && pesquisa.status === "draft" ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Esta pesquisa ainda é rascunho: revise as perguntas e ative-a para começar a convidar.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Convidados" value={String(contagem.convidados)} icon={Users} />
        <MetricCard label="Abriram o link" value={String(contagem.abriram)} icon={Eye} />
        <MetricCard label="Respondendo" value={String(contagem.respondendo)} icon={Send} />
        <MetricCard label="Concluíram" value={String(contagem.concluidas)} icon={CheckCircle2} />
      </div>

      <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtro">
          {(
            [
              ["todos", "Todos"],
              ["pendentes", "Pendentes"],
              ["completed", "Concluídas"],
              ["closed", "Encerrados"],
            ] as const
          ).map(([valor, rotulo]) => (
            <Button
              key={valor}
              size="sm"
              variant={filtro === valor ? "default" : "outline"}
              aria-pressed={filtro === valor}
              onClick={() => setFiltro(valor)}
            >
              {rotulo}
            </Button>
          ))}
        </div>
        {selecionados.size > 0 ? (
          <p className="text-xs text-muted-foreground">
            {selecionados.size} selecionado{selecionados.size === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>

      <Card>
        {convites === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Carregando convites...</p>
        ) : visiveis.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Users className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {convites.length === 0
                ? "Nenhum parceiro convidado ainda."
                : "Nenhum convite neste filtro."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <span className="sr-only">Selecionar</span>
                  </TableHead>
                  <TableHead>Parceiro</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Progresso</TableHead>
                  <TableHead>Convidado em</TableHead>
                  <TableHead>Último envio</TableHead>
                  <TableHead>Lembretes</TableHead>
                  <TableActionsHead>Ações</TableActionsHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiveis.map((c) => {
                  const pendente = PENDENTES.includes(c.status);
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          aria-label={`Selecionar ${c.contact.name}`}
                          checked={selecionados.has(c.id)}
                          disabled={!pendente}
                          onChange={() => alternarSelecao(c.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Link href={`/contacts/${c.contact.id}`} className="font-medium hover:underline">
                          {c.contact.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {[c.contact.company, c.contact.email ?? "sem e-mail"].filter(Boolean).join(" · ")}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={CONVITE_VARIANT[c.status]}>{CONVITE_STATUS_LABEL[c.status]}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {c.respondidas}/{c.total}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(c.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {c.ultimoEnvio ? (
                          <span className="text-sm">
                            {c.ultimoEnvio.kind === "reminder" ? "Lembrete" : "Convite"} por{" "}
                            {c.ultimoEnvio.channel === "email" ? "e-mail" : c.ultimoEnvio.channel} ·{" "}
                            <span
                              className={
                                c.ultimoEnvio.status === "failed" || c.ultimoEnvio.status === "bounced"
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                              }
                              title={c.ultimoEnvio.errorMessage ?? undefined}
                            >
                              {ENVIO_STATUS_LABEL[c.ultimoEnvio.status] ?? c.ultimoEnvio.status}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">só o link</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {c.remindersSent}
                        {c.lastReminderAt ? (
                          <span className="text-xs text-muted-foreground"> · {formatDateTime(c.lastReminderAt)}</span>
                        ) : null}
                      </TableCell>
                      <TableActionsCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Copiar link de ${c.contact.name}`}
                          title="Copiar link"
                          onClick={() => copiarLink(c)}
                        >
                          <Copy />
                        </Button>
                        {pendente ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Encerrar convite de ${c.contact.name}`}
                            title="Encerrar (o link deixa de aceitar resposta)"
                            onClick={() => acaoNoConvite(c, "encerrar")}
                          >
                            <Lock />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Reabrir convite de ${c.contact.name}`}
                            title="Reabrir (o parceiro volta a poder editar)"
                            onClick={() => acaoNoConvite(c, "reabrir")}
                          >
                            <LockOpen />
                          </Button>
                        )}
                      </TableActionsCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Dialog open={convidarAberto} onOpenChange={setConvidarAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar parceiros</DialogTitle>
            <DialogDescription>
              Cada parceiro das listas escolhidas ganha o próprio link. Quem já tem convite aberto
              nesta pesquisa não é convidado de novo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Listas</legend>
              {listas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma lista de parceiros.</p>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
                  {listas.map((l) => (
                    <label
                      key={l.id}
                      className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={listasEscolhidas.includes(l.id)}
                        onChange={() =>
                          setListasEscolhidas((atual) =>
                            atual.includes(l.id) ? atual.filter((v) => v !== l.id) : [...atual, l.id]
                          )
                        }
                      />
                      <span className="flex-1">{l.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {l.contactCount} contato{l.contactCount === 1 ? "" : "s"}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Enviar o convite por</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={porEmail}
                  onChange={(e) => setPorEmail(e.target.checked)}
                />
                E-mail <span className="text-xs text-muted-foreground">(endereço principal do parceiro)</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" className="h-4 w-4" disabled />
                WhatsApp <span className="text-xs">— chega com a linha da Expansão</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Sem canal marcado, o convite só cria o link, para você copiar na tabela.
              </p>
            </fieldset>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvidarAberto(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={convidar} disabled={enviando || listasEscolhidas.length === 0}>
              {enviando ? "Convidando..." : "Convidar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lembrarAberto} onOpenChange={setLembrarAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lembrar parceiros</DialogTitle>
            <DialogDescription>
              Vai um e-mail de lembrete com o link de cada um. Quem concluiu não recebe.
              {limites
                ? ` No máximo ${limites.maximo} lembrete${limites.maximo === 1 ? "" : "s"} por parceiro, com ${limites.intervaloHoras}h entre eles.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="escopo-lembrete"
                className="h-4 w-4 accent-primary"
                checked={escopoLembrete === "pendentes"}
                onChange={() => setEscopoLembrete("pendentes")}
              />
              Todos os pendentes ({contagem.pendentes})
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="escopo-lembrete"
                className="h-4 w-4 accent-primary"
                checked={escopoLembrete === "selecionados"}
                disabled={selecionados.size === 0}
                onChange={() => setEscopoLembrete("selecionados")}
              />
              Só os selecionados na tabela ({selecionados.size})
            </label>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLembrarAberto(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={lembrar} disabled={enviando}>
              {enviando ? "Enviando..." : "Lembrar por e-mail"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
