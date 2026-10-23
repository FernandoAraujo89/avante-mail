"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  BellRing,
  CheckCircle2,
  ClipboardList,
  Copy,
  CopyPlus,
  Eye,
  Lock,
  LockOpen,
  Pencil,
  Send,
  Settings2,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import {
  andamento,
  BarraDeAndamento,
  BarraDeRespostas,
} from "@/components/pesquisas/barra-de-andamento";
import { ProximoPassoDaRegua } from "@/components/pesquisas/regua";
import { RegistroDePasso } from "@/components/pesquisas/registro-de-passo";
import { SeletorDeParceiros } from "@/components/pesquisas/seletor-de-parceiros";
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
import { linkDaPrevia } from "@/lib/pesquisas/previa";
import type { LimitesDeLembrete } from "@/lib/pesquisas/lembretes";
import { PASSO_LABEL } from "@/lib/pesquisas/mapeamento";
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
  const router = useRouter();

  const [pesquisa, setPesquisa] = useState<PesquisaDto | null>(null);
  const [convites, setConvites] = useState<ConviteDto[] | null>(null);
  const [listas, setListas] = useState<ListaDto[]>([]);
  const [limites, setLimites] = useState<LimitesDeLembrete | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const [convidarAberto, setConvidarAberto] = useState(false);
  // Lista inteira ou parceiros escolhidos um a um.
  const [modoDoConvite, setModoDoConvite] = useState<"listas" | "parceiros">("listas");
  const [listasEscolhidas, setListasEscolhidas] = useState<string[]>([]);
  const [parceirosEscolhidos, setParceirosEscolhidos] = useState<Map<string, string>>(new Map());
  const [porEmail, setPorEmail] = useState(true);
  const [porWhatsApp, setPorWhatsApp] = useState(false);
  const [lembrarAberto, setLembrarAberto] = useState(false);
  const [escopoLembrete, setEscopoLembrete] = useState<"selecionados" | "pendentes">("pendentes");
  const [enviando, setEnviando] = useState(false);
  const [formError, setFormError] = useState("");

  // Mapeamento da Parceria: registrar um passo da régua num convite.
  const [registrando, setRegistrando] = useState<ConviteDto | null>(null);

  // Gerenciar a pesquisa: duplicar, mudar a situação, excluir.
  const [gerenciarAberto, setGerenciarAberto] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [ocupado, setOcupado] = useState(false);

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
  const progresso = useMemo(() => andamento(convites ?? []), [convites]);
  const whatsappPronto = pesquisa?.whatsapp.pronto ?? false;
  const canais = [porEmail ? "email" : null, porWhatsApp && whatsappPronto ? "whatsapp" : null].filter(
    Boolean
  ) as ("email" | "whatsapp")[];

  function alternarSelecao(conviteId: string) {
    setSelecionados((s) => {
      const copia = new Set(s);
      if (copia.has(conviteId)) copia.delete(conviteId);
      else copia.add(conviteId);
      return copia;
    });
  }

  async function validar(c: ConviteDto, desfazer: boolean) {
    setErro("");
    setAviso("");
    try {
      const res = await fetch(`/api/pesquisas/${id}/convites/${c.id}/validar`, { method: desfazer ? "DELETE" : "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível validar.");
      setAviso(desfazer ? `Validação de ${c.contact.name} desfeita.` : `Resposta de ${c.contact.name} validada.`);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }

  async function copiarLink(c: ConviteDto) {
    try {
      await navigator.clipboard.writeText(c.link);
      setAviso(`Link de ${c.contact.name} copiado.`);
    } catch {
      setAviso(`Link de ${c.contact.name}: ${c.link}`);
    }
  }

  async function mudarStatus(status: SurveyStatus) {
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      const res = await fetch(`/api/pesquisas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível atualizar a pesquisa.");
      setAviso(`Pesquisa ${STATUS_LABEL[json.status as SurveyStatus].toLowerCase()}.`);
      setGerenciarAberto(false);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  async function duplicar() {
    setOcupado(true);
    setErro("");
    try {
      const res = await fetch(`/api/pesquisas/${id}/duplicar`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível duplicar.");
      router.push(`/pesquisas/${json.id}/editar`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setOcupado(false);
    }
  }

  async function excluir() {
    setOcupado(true);
    setErro("");
    try {
      const res = await fetch(`/api/pesquisas/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível excluir.");
      router.push("/pesquisas");
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setConfirmandoExclusao(false);
      setGerenciarAberto(false);
      setOcupado(false);
    }
  }

  async function reenviar(c: ConviteDto) {
    setErro("");
    setAviso("");
    try {
      const res = await fetch(`/api/pesquisas/${id}/convites/${c.id}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: whatsappPronto ? ["email", "whatsapp"] : ["email"] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível reenviar.");
      const partes = [
        json.enfileirados?.email ? "e-mail na fila" : null,
        json.enfileirados?.whatsapp ? "WhatsApp na fila" : null,
      ].filter(Boolean);
      setAviso(
        partes.length
          ? `Convite de ${c.contact.name} reenviado: ${partes.join(" e ")}.`
          : `${c.contact.name} não tem endereço que aceite o canal — copie o link.`
      );
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }

  async function excluirConvite(c: ConviteDto) {
    setErro("");
    setAviso("");
    try {
      const res = await fetch(`/api/pesquisas/${id}/convites/${c.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível excluir o convite.");
      setAviso(`Convite de ${c.contact.name} excluído.`);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }

  async function emLote(acao: "encerrar" | "reabrir") {
    setErro("");
    setAviso("");
    try {
      const res = await fetch(`/api/pesquisas/${id}/convites`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteIds: [...selecionados], acao }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível aplicar.");
      setAviso(
        `${json.feitos} convite${json.feitos === 1 ? "" : "s"} ${acao === "encerrar" ? "encerrado" : "reaberto"}${
          json.feitos === 1 ? "" : "s"
        }${json.pulados ? ` · ${json.pulados} sem mudança (${json.erros.join("; ")})` : ""}.`
      );
      setSelecionados(new Set());
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
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
    setModoDoConvite("listas");
    setListasEscolhidas([]);
    setParceirosEscolhidos(new Map());
    setPorEmail(true);
    setPorWhatsApp(whatsappPronto);
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
        body: JSON.stringify(
          modoDoConvite === "listas"
            ? { listIds: listasEscolhidas, channels: canais }
            : { contactIds: [...parceirosEscolhidos.keys()], channels: canais }
        ),
      });
      const json = (await res.json()) as ResultadoConvite & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Não foi possível convidar.");
      const partes = [
        `${json.convidados} convidado${json.convidados === 1 ? "" : "s"}`,
        json.enfileirados.email ? `${json.enfileirados.email} e-mail${json.enfileirados.email === 1 ? "" : "s"} na fila` : null,
        json.enfileirados.whatsapp ? `${json.enfileirados.whatsapp} WhatsApp na fila` : null,
        json.semEndereco ? `${json.semEndereco} sem endereço nos canais escolhidos (só o link)` : null,
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
    setPorEmail(true);
    setPorWhatsApp(whatsappPronto);
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
            ? { todosPendentes: true, channels: canais }
            : { inviteIds: [...selecionados], channels: canais }
        ),
      });
      const json = (await res.json()) as ResultadoLembrete & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Não foi possível lembrar.");
      const partes = [
        `${json.lembrados} lembrete${json.lembrados === 1 ? "" : "s"} na fila`,
        json.pulados.concluido ? `${json.pulados.concluido} já concluíram` : null,
        json.pulados.limite ? `${json.pulados.limite} no teto de lembretes` : null,
        json.pulados.intervalo ? `${json.pulados.intervalo} lembrado${json.pulados.intervalo === 1 ? "" : "s"} há pouco` : null,
        json.pulados.semEndereco ? `${json.pulados.semEndereco} sem endereço nos canais escolhidos` : null,
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
            <Button variant="outline" onClick={() => setGerenciarAberto(true)}>
              <Settings2 />
              Gerenciar
            </Button>
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
            <Button variant="outline" asChild>
              <a href={linkDaPrevia(id)} target="_blank" rel="noopener" title="Abre a pesquisa com o layout real do parceiro, em nova aba">
                <Eye />
                Ver como o parceiro
              </a>
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

      {convites ? (
        <Card className="mt-4 p-4 sm:p-5">
          <BarraDeAndamento dados={progresso} />
        </Card>
      ) : null}

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
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Ações nos selecionados">
            <span className="text-xs text-muted-foreground">
              {selecionados.size} selecionado{selecionados.size === 1 ? "" : "s"}:
            </span>
            <Button size="sm" variant="outline" disabled={!ativa} onClick={abrirLembrar}>
              <BellRing />
              Lembrar
            </Button>
            <Button size="sm" variant="outline" onClick={() => emLote("encerrar")}>
              <Lock />
              Encerrar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelecionados(new Set())}>
              Limpar
            </Button>
          </div>
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
                  <TableHead>Régua</TableHead>
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
                      <TableCell>
                        <BarraDeRespostas respondidas={c.respondidas} total={c.total} />
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
                      <TableCell>
                        <div className="grid min-w-48 gap-0.5">
                          <ProximoPassoDaRegua convite={c} />
                          {c.validatedAt ? (
                            <span className="text-xs text-success-dark">
                              Validado{c.validatedByName ? ` por ${c.validatedByName}` : ""} · {formatDate(c.validatedAt)}
                            </span>
                          ) : c.closedReason === "sem_resposta" ? (
                            <span className="text-xs text-muted-foreground">Sem resposta (régua encerrada)</span>
                          ) : null}
                          {c.ultimoPasso ? (
                            <span className="text-xs text-muted-foreground" title={c.ultimoPasso.note ?? undefined}>
                              Último: {PASSO_LABEL[c.ultimoPasso.kind]} · {formatDate(c.ultimoPasso.at)}
                            </span>
                          ) : null}
                        </div>
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
                            aria-label={`Registrar passo da régua para ${c.contact.name}`}
                            title="Registrar passo da régua (mensagem, ligação, reunião, sem resposta)"
                            onClick={() => setRegistrando(c)}
                          >
                            <ClipboardList />
                          </Button>
                        ) : null}
                        {c.status === "completed" && !c.validatedAt ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Validar resposta de ${c.contact.name}`}
                            title="Validar os dados (etapa 5)"
                            onClick={() => validar(c, false)}
                          >
                            <BadgeCheck />
                          </Button>
                        ) : null}
                        {pendente ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Reenviar convite de ${c.contact.name}`}
                            title={ativa ? "Reenviar o convite (e-mail; e WhatsApp, se pronto)" : "A pesquisa precisa estar ativa"}
                            disabled={!ativa}
                            onClick={() => reenviar(c)}
                          >
                            <Send />
                          </Button>
                        ) : null}
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
                        {c.respondidas === 0 ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Excluir convite de ${c.contact.name}`}
                            title="Excluir o convite (só sem respostas)"
                            onClick={() => excluirConvite(c)}
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </TableActionsCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {registrando ? (
        <RegistroDePasso
          surveyId={id}
          inviteId={registrando.id}
          parceiro={registrando.contact.name}
          aberto
          onFechar={() => setRegistrando(null)}
          onRegistrado={(m) => {
            setAviso(m);
            carregar();
          }}
        />
      ) : null}

      <Dialog open={convidarAberto} onOpenChange={setConvidarAberto}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Convidar parceiros</DialogTitle>
            <DialogDescription>
              Cada parceiro ganha o próprio link. Quem já tem convite aberto nesta pesquisa não é
              convidado de novo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Como escolher">
              {(
                [
                  ["listas", "Listas inteiras"],
                  ["parceiros", "Parceiros específicos"],
                ] as const
              ).map(([valor, rotulo]) => (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={modoDoConvite === valor}
                  onClick={() => setModoDoConvite(valor)}
                  className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${
                    modoDoConvite === valor ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>

            {modoDoConvite === "parceiros" ? (
              <SeletorDeParceiros
                surveyId={id}
                listas={listas}
                selecionados={parceirosEscolhidos}
                onChange={setParceirosEscolhidos}
              />
            ) : null}

            <fieldset className={`grid gap-2 ${modoDoConvite === "parceiros" ? "hidden" : ""}`}>
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
              <label className={`flex items-center gap-2 text-sm ${whatsappPronto ? "" : "text-muted-foreground"}`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={porWhatsApp && whatsappPronto}
                  disabled={!whatsappPronto}
                  onChange={(e) => setPorWhatsApp(e.target.checked)}
                />
                WhatsApp{" "}
                <span className="text-xs text-muted-foreground">
                  {whatsappPronto ? "(número Avante Expansão, telefone principal)" : `— ${pesquisa?.whatsapp.motivo ?? ""}`}
                </span>
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
            <Button
              onClick={convidar}
              disabled={
                enviando ||
                (modoDoConvite === "listas" ? listasEscolhidas.length === 0 : parceirosEscolhidos.size === 0)
              }
            >
              {enviando
                ? "Convidando..."
                : modoDoConvite === "parceiros" && parceirosEscolhidos.size > 0
                  ? `Convidar ${parceirosEscolhidos.size} parceiro${parceirosEscolhidos.size === 1 ? "" : "s"}`
                  : "Convidar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={gerenciarAberto} onOpenChange={(open) => { setGerenciarAberto(open); if (!open) setConfirmandoExclusao(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerenciar a pesquisa</DialogTitle>
            <DialogDescription>
              {pesquisa ? `${pesquisa.name} · ${STATUS_LABEL[pesquisa.status].toLowerCase()} · ${contagem.convidados} convidado${contagem.convidados === 1 ? "" : "s"}` : ""}
            </DialogDescription>
          </DialogHeader>
          {!confirmandoExclusao ? (
            <div className="grid gap-2">
              <Button variant="outline" className="justify-start" asChild>
                <Link href={`/pesquisas/${id}/editar`}>
                  <Pencil />
                  Editar perguntas, textos e mensagens do convite
                </Link>
              </Button>
              <Button variant="outline" className="justify-start" disabled={ocupado} onClick={duplicar}>
                <CopyPlus />
                Duplicar (cópia em rascunho para outra rodada ou variação)
              </Button>
              {pesquisa?.status === "draft" ? (
                <Button variant="outline" className="justify-start" disabled={ocupado} onClick={() => mudarStatus("active")}>
                  <CheckCircle2 />
                  Ativar — libera convites e respostas
                </Button>
              ) : pesquisa?.status === "active" ? (
                <Button variant="outline" className="justify-start" disabled={ocupado} onClick={() => mudarStatus("closed")}>
                  <Lock />
                  Encerrar — os links param de aceitar respostas
                </Button>
              ) : (
                <Button variant="outline" className="justify-start" disabled={ocupado} onClick={() => mudarStatus("active")}>
                  <LockOpen />
                  Reabrir — volta a aceitar respostas e convites
                </Button>
              )}
              <Button
                variant="outline"
                className="justify-start border-destructive/40 text-destructive hover:bg-destructive/10"
                disabled={ocupado || (contagem.convidados > 0 && pesquisa?.status !== "closed")}
                title={contagem.convidados > 0 && pesquisa?.status !== "closed" ? "Encerre a pesquisa antes de excluir." : undefined}
                onClick={() => setConfirmandoExclusao(true)}
              >
                <Trash2 />
                Excluir a pesquisa
              </Button>
              {contagem.convidados > 0 && pesquisa?.status !== "closed" ? (
                <p className="text-xs text-muted-foreground">
                  Com parceiros convidados, a exclusão só é liberada depois de encerrar.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3">
              <p className="text-sm">
                Excluir <strong>{pesquisa?.name}</strong> apaga {contagem.convidados} convite
                {contagem.convidados === 1 ? "" : "s"}, todas as respostas e o histórico de envios. Não dá para
                desfazer — o relatório some junto.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmandoExclusao(false)} disabled={ocupado}>
                  Voltar
                </Button>
                <Button variant="destructive" onClick={excluir} disabled={ocupado}>
                  {ocupado ? "Excluindo..." : "Excluir de vez"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={lembrarAberto} onOpenChange={setLembrarAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lembrar parceiros</DialogTitle>
            <DialogDescription>
              Vai um lembrete com o link de cada um. Quem concluiu não recebe.
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
            <fieldset className="mt-2 grid gap-2">
              <legend className="mb-1 text-sm font-medium">Lembrar por</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={porEmail}
                  onChange={(e) => setPorEmail(e.target.checked)}
                />
                E-mail
              </label>
              <label className={`flex items-center gap-2 text-sm ${whatsappPronto ? "" : "text-muted-foreground"}`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={porWhatsApp && whatsappPronto}
                  disabled={!whatsappPronto}
                  onChange={(e) => setPorWhatsApp(e.target.checked)}
                />
                WhatsApp{whatsappPronto ? "" : ` — ${pesquisa?.whatsapp.motivo ?? ""}`}
              </label>
            </fieldset>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLembrarAberto(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={lembrar} disabled={enviando || canais.length === 0}>
              {enviando ? "Enviando..." : "Lembrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
