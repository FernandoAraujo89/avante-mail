"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Pencil, Plus, Trash2 } from "lucide-react";

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
import {
  SURVEY_OBJECTIVES,
  type SurveyObjective,
  type SurveyStatus,
} from "@/lib/db/schema";
import { formatDate } from "@/lib/format";
import {
  OBJETIVO_DESCRICAO,
  OBJETIVO_LABEL,
  STATUS_LABEL,
  type PesquisaResumoDto,
} from "@/lib/pesquisas/rotulos";

const STATUS_VARIANT: Record<SurveyStatus, "secondary" | "success" | "warning"> = {
  draft: "secondary",
  active: "success",
  closed: "warning",
};

export default function PesquisasPage() {
  const router = useRouter();
  const [itens, setItens] = useState<PesquisaResumoDto[] | null>(null);
  const [error, setError] = useState("");

  const [novoAberto, setNovoAberto] = useState(false);
  const [objetivo, setObjetivo] = useState<SurveyObjective>("dados_empresa");
  const [nome, setNome] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [excluindo, setExcluindo] = useState<PesquisaResumoDto | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const res = await fetch("/api/pesquisas");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar as pesquisas.");
      setItens(json);
    } catch (err) {
      setItens([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function abrirNovo(obj: SurveyObjective) {
    setObjetivo(obj);
    setNome("");
    setFormError("");
    setNovoAberto(true);
  }

  async function criar() {
    setSaving(true);
    setFormError("");
    try {
      const res = await fetch("/api/pesquisas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: objetivo, name: nome }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao criar a pesquisa.");
      router.push(`/pesquisas/${json.id}/editar`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  async function mudarStatus(p: PesquisaResumoDto, status: SurveyStatus) {
    setError("");
    try {
      const res = await fetch(`/api/pesquisas/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao atualizar a pesquisa.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function excluir() {
    if (!excluindo) return;
    setError("");
    try {
      const res = await fetch(`/api/pesquisas/${excluindo.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao excluir a pesquisa.");
      setExcluindo(null);
      await load();
    } catch (err) {
      setExcluindo(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Pesquisas com parceiros"
        description="As três frentes do acompanhamento: cada pesquisa tem um objetivo, e cada parceiro responde pelo link dele."
      >
        <Button onClick={() => abrirNovo("dados_empresa")}>
          <Plus />
          Nova pesquisa
        </Button>
      </PageHeader>

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6">
        {SURVEY_OBJECTIVES.map((obj) => {
          const lista = (itens ?? []).filter((p) => p.objective === obj);
          return (
            <section key={obj} aria-labelledby={`objetivo-${obj}`}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 id={`objetivo-${obj}`} className="text-base font-semibold">
                    {OBJETIVO_LABEL[obj]}
                  </h2>
                  <p className="text-sm text-muted-foreground">{OBJETIVO_DESCRICAO[obj]}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => abrirNovo(obj)}>
                  <Plus />
                  Nova
                </Button>
              </div>

              {itens === null ? (
                <Card>
                  <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
                </Card>
              ) : lista.length === 0 ? (
                <Card>
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <ClipboardCheck className="h-6 w-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Nenhuma pesquisa de {OBJETIVO_LABEL[obj].toLowerCase()} ainda.
                    </p>
                  </div>
                </Card>
              ) : (
                <div className="grid gap-3">
                  {lista.map((p) => (
                    <Card key={p.id} className="@container p-4">
                      <div className="flex flex-col gap-3 @xl:flex-row @xl:items-center @xl:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/pesquisas/${p.id}/editar`}
                              className="text-base font-semibold break-words hover:underline"
                            >
                              {p.name}
                            </Link>
                            <Badge variant={STATUS_VARIANT[p.status]}>
                              {STATUS_LABEL[p.status]}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {p.questionCount} pergunta{p.questionCount === 1 ? "" : "s"} ·{" "}
                            {p.inviteCount} convidado{p.inviteCount === 1 ? "" : "s"} ·{" "}
                            {p.completedCount} concluída{p.completedCount === 1 ? "" : "s"}
                            {p.createdByName ? ` · criada por ${p.createdByName}` : ""} em{" "}
                            {formatDate(p.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/pesquisas/${p.id}/editar`}>
                              <Pencil />
                              Editar
                            </Link>
                          </Button>
                          {p.status === "draft" ? (
                            <Button size="sm" onClick={() => mudarStatus(p, "active")}>
                              Ativar
                            </Button>
                          ) : p.status === "active" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => mudarStatus(p, "closed")}
                            >
                              Encerrar
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => mudarStatus(p, "active")}>
                              Reabrir
                            </Button>
                          )}
                          {p.inviteCount === 0 ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Excluir ${p.name}`}
                              onClick={() => setExcluindo(p)}
                            >
                              <Trash2 />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova pesquisa</DialogTitle>
            <DialogDescription>
              Escolha a frente e dê um nome. As perguntas vêm na tela seguinte.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="nova-objetivo">Objetivo</Label>
              <Select
                value={objetivo}
                onValueChange={(v) => setObjetivo(v as SurveyObjective)}
              >
                <SelectTrigger id="nova-objetivo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SURVEY_OBJECTIVES.map((obj) => (
                    <SelectItem key={obj} value={obj}>
                      {OBJETIVO_LABEL[obj]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{OBJETIVO_DESCRICAO[objetivo]}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nova-nome">Nome</Label>
              <Input
                id="nova-nome"
                value={nome}
                maxLength={120}
                placeholder="ex.: NPS 2026 · 4º trimestre"
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !saving) criar();
                }}
              />
            </div>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovoAberto(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={criar} disabled={saving || !nome.trim()}>
              {saving ? "Criando..." : "Criar e montar perguntas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={excluindo !== null} onOpenChange={(open) => !open && setExcluindo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir pesquisa</DialogTitle>
            <DialogDescription>
              &quot;{excluindo?.name}&quot; ainda não tem convidados e vai sumir com as perguntas.
              Não dá para desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcluindo(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={excluir}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
