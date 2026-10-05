"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Mail, MessageCircle, Plus, Send } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  CampaignRequestChannel,
  CampaignRequestStatus,
} from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import type { Perfil } from "@/lib/perfis";
import {
  CANAL_LABEL,
  STATUS_LABEL,
  type SolicitacaoDto,
} from "@/lib/solicitacoes/rotulos";
import { cn } from "@/lib/utils";

type ListaDto = {
  id: string;
  name: string;
  kind: string | null;
  contactCount: number;
};

const STATUS_VARIANT: Record<
  CampaignRequestStatus,
  "warning" | "info" | "success" | "secondary"
> = {
  pendente: "warning",
  em_andamento: "info",
  concluida: "success",
  recusada: "secondary",
};

const CANAIS: { valor: CampaignRequestChannel; icone: typeof Mail }[] = [
  { valor: "email", icone: Mail },
  { valor: "whatsapp", icone: MessageCircle },
];

const ABERTAS: CampaignRequestStatus[] = ["pendente", "em_andamento"];

export default function SolicitacoesPage() {
  const [itens, setItens] = useState<SolicitacaoDto[] | null>(null);
  const [listas, setListas] = useState<ListaDto[]>([]);
  const [me, setMe] = useState<{ id: string; role: Perfil } | null>(null);
  const [filtro, setFiltro] = useState<"abertas" | "todas">("abertas");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Novo pedido
  const [novoAberto, setNovoAberto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [canais, setCanais] = useState<CampaignRequestChannel[]>([]);
  const [listasEscolhidas, setListasEscolhidas] = useState<string[]>([]);
  const [briefing, setBriefing] = useState("");
  const [quando, setQuando] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Resposta do marketing
  const [respondendo, setRespondendo] = useState<SolicitacaoDto | null>(null);
  const [resposta, setResposta] = useState("");

  const isAdmin = me?.role === "admin";

  const load = useCallback(async () => {
    try {
      setError("");
      const [resItens, resListas, resMe] = await Promise.all([
        fetch("/api/solicitacoes"),
        fetch("/api/lists"),
        fetch("/api/auth/me"),
      ]);
      const json = await resItens.json();
      if (!resItens.ok) {
        throw new Error(json.error ?? "Erro ao carregar as solicitações.");
      }
      setItens(json);
      if (resListas.ok) setListas(await resListas.json());
      if (resMe.ok) setMe(await resMe.json());
    } catch (err) {
      setItens([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A lista de leads não recebe campanha — nem aparece para escolha.
  const listasDeParceiros = useMemo(
    () => listas.filter((l) => l.kind === null),
    [listas]
  );

  const visiveis = useMemo(
    () =>
      (itens ?? []).filter(
        (s) => filtro === "todas" || ABERTAS.includes(s.status)
      ),
    [itens, filtro]
  );

  function alternar<T>(lista: T[], valor: T): T[] {
    return lista.includes(valor)
      ? lista.filter((v) => v !== valor)
      : [...lista, valor];
  }

  function abrirNovo() {
    setTitulo("");
    setCanais([]);
    setListasEscolhidas([]);
    setBriefing("");
    setQuando("");
    setFormError("");
    setNotice("");
    setNovoAberto(true);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (canais.length === 0) {
      setFormError("Escolha o canal: e-mail, WhatsApp ou os dois.");
      return;
    }
    if (listasEscolhidas.length === 0) {
      setFormError("Escolha pelo menos uma lista.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const res = await fetch("/api/solicitacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titulo,
          channels: canais,
          listIds: listasEscolhidas,
          briefing,
          desiredAt: quando ? new Date(quando).toISOString() : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao enviar o pedido.");
      setNovoAberto(false);
      setNotice(
        `Pedido "${json.title}" enviado — o marketing foi avisado por e-mail.`
      );
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function atualizar(
    s: SolicitacaoDto,
    mudancas: { status?: CampaignRequestStatus; responseNote?: string }
  ) {
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/solicitacoes/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mudancas),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao atualizar o pedido.");
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function cancelar(s: SolicitacaoDto) {
    if (!window.confirm(`Cancelar o pedido "${s.title}"?`)) return;
    setError("");
    try {
      const res = await fetch(`/api/solicitacoes/${s.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao cancelar o pedido.");
      setNotice(`Pedido "${s.title}" cancelado.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleResposta(event: React.FormEvent) {
    event.preventDefault();
    if (!respondendo) return;
    setSaving(true);
    const ok = await atualizar(respondendo, { responseNote: resposta });
    setSaving(false);
    if (ok) setRespondendo(null);
  }

  return (
    <>
      <PageHeader
        title="Solicitações de campanha"
        description={
          isAdmin
            ? "Pedidos do Sucesso do cliente. Crie a campanha a partir do pedido e acompanhe a situação."
            : "Peça ao marketing uma campanha de e-mail ou WhatsApp para as suas listas. Quem cria e dispara é o marketing."
        }
      >
        <Button onClick={abrirNovo}>
          <Plus />
          Nova solicitação
        </Button>
      </PageHeader>

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-4 rounded-lg border border-success-dark/30 bg-success-light/20 px-4 py-3 text-sm text-success-dark">
          {notice}
        </div>
      ) : null}

      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filtro"
      >
        {(
          [
            ["abertas", "Em aberto"],
            ["todas", "Todas"],
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

      {itens === null ? (
        <Card>
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando solicitações...
          </p>
        </Card>
      ) : visiveis.length === 0 ? (
        <Card>
          <p className="py-12 text-center text-sm text-muted-foreground">
            {filtro === "abertas"
              ? "Nenhuma solicitação em aberto."
              : "Nenhuma solicitação ainda."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {visiveis.map((s) => {
            const meu = me?.id === s.requestedBy?.id;
            return (
              <Card key={s.id} className="@container p-4 sm:p-5">
                <div className="flex flex-col gap-3 @xl:flex-row @xl:items-start @xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold break-words">
                        {s.title}
                      </h2>
                      <Badge variant={STATUS_VARIANT[s.status]}>
                        {STATUS_LABEL[s.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pedido por {s.requestedBy?.name ?? "—"} em{" "}
                      {formatDateTime(s.createdAt)}
                      {s.desiredAt
                        ? ` · para ${formatDateTime(s.desiredAt)}`
                        : " · sem data definida"}
                    </p>
                  </div>

                  {isAdmin ? (
                    <Select
                      value={s.status}
                      onValueChange={(v) =>
                        atualizar(s, { status: v as CampaignRequestStatus })
                      }
                    >
                      <SelectTrigger
                        className="w-full @xl:w-44"
                        aria-label="Situação do pedido"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(
                          Object.keys(STATUS_LABEL) as CampaignRequestStatus[]
                        ).map((st) => (
                          <SelectItem key={st} value={st}>
                            {STATUS_LABEL[st]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>

                <dl className="mt-4 grid gap-3 text-sm @lg:grid-cols-[8rem_1fr]">
                  <dt className="text-muted-foreground">Canal</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {s.channels.map((c) => (
                      <Badge key={c} variant="outline">
                        {CANAL_LABEL[c]}
                      </Badge>
                    ))}
                  </dd>
                  <dt className="text-muted-foreground">Listas</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {s.lists.map((l) =>
                      l.name ? (
                        <Link
                          key={l.id}
                          href={`/lists/${l.id}`}
                          className="rounded-sm bg-accent px-2 py-1 text-xs font-semibold text-primary hover:underline"
                        >
                          {l.name}
                        </Link>
                      ) : (
                        <span
                          key={l.id}
                          className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground"
                        >
                          Lista removida
                        </span>
                      )
                    )}
                  </dd>
                  <dt className="text-muted-foreground">O que comunicar</dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {s.briefing}
                  </dd>
                  {s.responseNote ? (
                    <>
                      <dt className="text-muted-foreground">
                        Resposta do marketing
                      </dt>
                      <dd className="whitespace-pre-wrap break-words">
                        {s.responseNote}
                        {s.handledBy ? (
                          <span className="text-muted-foreground">
                            {" "}
                            — {s.handledBy.name}
                          </span>
                        ) : null}
                      </dd>
                    </>
                  ) : null}
                </dl>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                  {isAdmin ? (
                    <>
                      {s.channels.map((c) => (
                        <Button key={c} asChild size="sm">
                          <Link
                            href={`/campaigns/new?solicitacao=${s.id}&canal=${c}`}
                          >
                            <Send />
                            Criar campanha de {CANAL_LABEL[c]}
                          </Link>
                        </Button>
                      ))}
                      {s.campaignId ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/campaigns/new?id=${s.campaignId}`}>
                            Abrir campanha criada
                          </Link>
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setResposta(s.responseNote ?? "");
                          setRespondendo(s);
                        }}
                      >
                        Responder
                      </Button>
                    </>
                  ) : null}
                  {(meu && s.status === "pendente") || isAdmin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => cancelar(s)}
                    >
                      {isAdmin && !meu ? "Excluir pedido" : "Cancelar pedido"}
                    </Button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Nova solicitação */}
      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova solicitação de campanha</DialogTitle>
            <DialogDescription>
              O marketing recebe o pedido por e-mail, monta a campanha e
              dispara.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="grid gap-4">
            {formError ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
                {formError}
              </p>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="sol-titulo">Título</Label>
              <Input
                id="sol-titulo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex.: Convite do treinamento para parceiros Diamante"
                required
              />
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">Canal</legend>
              <div className="flex flex-wrap gap-2">
                {CANAIS.map(({ valor, icone: Icone }) => {
                  const ativo = canais.includes(valor);
                  return (
                    <button
                      key={valor}
                      type="button"
                      aria-pressed={ativo}
                      onClick={() => setCanais((c) => alternar(c, valor))}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border-[1.5px] px-3 py-2 text-sm font-medium transition-colors",
                        ativo
                          ? "border-primary bg-accent text-primary"
                          : "border-input text-muted-foreground hover:bg-muted"
                      )}
                    >
                      <Icone className="size-4" />
                      {CANAL_LABEL[valor]}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">
                Listas ({listasEscolhidas.length} escolhida
                {listasEscolhidas.length === 1 ? "" : "s"})
              </legend>
              {listasDeParceiros.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma lista ainda.{" "}
                  <Link href="/lists" className="text-primary underline">
                    Crie as listas
                  </Link>{" "}
                  antes de pedir a campanha.
                </p>
              ) : (
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-border p-2">
                  {listasDeParceiros.map((l) => (
                    <label
                      key={l.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={listasEscolhidas.includes(l.id)}
                        onChange={() =>
                          setListasEscolhidas((v) => alternar(v, l.id))
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">{l.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {l.contactCount} contato
                        {l.contactCount === 1 ? "" : "s"}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <div className="grid gap-2">
              <Label htmlFor="sol-briefing">
                O que a campanha precisa comunicar
              </Label>
              <Textarea
                id="sol-briefing"
                value={briefing}
                onChange={(e) => setBriefing(e.target.value)}
                rows={5}
                placeholder="Assunto, mensagem principal, links, chamada para ação…"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="sol-quando">Quando deve sair (opcional)</Label>
              <Input
                id="sol-quando"
                type="datetime-local"
                value={quando}
                onChange={(e) => setQuando(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNovoAberto(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Enviando..." : "Enviar pedido"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Resposta do marketing */}
      <Dialog
        open={respondendo !== null}
        onOpenChange={(open) => {
          if (!open) setRespondendo(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Responder ao pedido</DialogTitle>
            <DialogDescription>
              Aparece para quem pediu, junto do pedido — data combinada, motivo
              de uma recusa, ajustes.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleResposta} className="grid gap-4">
            <Textarea
              value={resposta}
              onChange={(e) => setResposta(e.target.value)}
              rows={4}
              aria-label="Resposta"
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRespondendo(null)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : "Salvar resposta"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
