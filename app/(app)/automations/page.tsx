"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pause, Play, Plus, Trash2, Workflow } from "lucide-react";

import { AutomationStatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/page-header";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { resumoDoGatilho } from "@/components/automations/labels";
import type { TriggerDraft } from "@/lib/automations/arvore";
import type { AutomationStatus } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";

type AutomationRow = {
  id: string;
  name: string;
  description: string | null;
  status: AutomationStatus;
  triggers: TriggerDraft[];
  stepCount: number;
  runCount: number;
  activeRunCount: number;
  updatedAt: string;
};

export default function AutomationsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AutomationRow[] | null>(null);
  const [lists, setLists] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");

  const [novoAberto, setNovoAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [criando, setCriando] = useState(false);

  const [removendo, setRemovendo] = useState<AutomationRow | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const [res, listas] = await Promise.all([
        fetch("/api/automations"),
        fetch("/api/lists").then((r) => r.json()),
      ]);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar automações.");
      setRows(json);
      setLists(Array.isArray(listas) ? listas : []);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function criar() {
    if (!nome.trim()) return;
    setCriando(true);
    setError("");
    try {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao criar a automação.");
      router.push(`/automations/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNovoAberto(false);
    } finally {
      setCriando(false);
    }
  }

  async function mudarStatus(row: AutomationRow, status: AutomationStatus) {
    setError("");
    try {
      const res = await fetch(`/api/automations/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao mudar o status.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmarRemocao() {
    if (!removendo) return;
    try {
      const res = await fetch(`/api/automations/${removendo.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao remover.");
      setRemovendo(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRemovendo(null);
    }
  }

  const ativas = (rows ?? []).filter((r) => r.status === "active").length;

  return (
    <>
      <PageHeader
        title="Automações"
        description="Fluxos que rodam sozinhos por contato, disparados por tags e listas."
      >
        <Button onClick={() => setNovoAberto(true)}>
          <Plus />
          Nova automação
        </Button>
      </PageHeader>

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}

      <Card>
        {rows === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando automações...
          </p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Workflow className="size-8 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">
              Nenhuma automação ainda. Uma automação manda a sequência certa
              sozinha — por exemplo: entrou a tag &quot;lead&quot;, envia o
              e-mail de boas-vindas, espera dois dias e, se não abriu, tenta
              pelo WhatsApp.
            </p>
            <Button onClick={() => setNovoAberto(true)} variant="outline">
              <Plus />
              Nova automação
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Automação</TableHead>
                <TableHead>Gatilhos</TableHead>
                <TableHead>Passos</TableHead>
                <TableHead>Contatos</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/automations/${row.id}`}
                      className="font-medium hover:underline"
                    >
                      {row.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      Atualizada em {formatDate(row.updatedAt)}
                    </p>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.triggers.length === 0
                      ? "—"
                      : row.triggers
                          .map((t) => resumoDoGatilho(t, { lists, templates: [], waTemplates: [] }))
                          .join(" · ")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.stepCount}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.activeRunCount > 0 ? (
                      <span title="No fluxo agora">
                        {row.activeRunCount} de {row.runCount}
                      </span>
                    ) : (
                      row.runCount
                    )}
                  </TableCell>
                  <TableCell>
                    <AutomationStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {row.status === "active" ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => mudarStatus(row, "paused")}
                          aria-label={`Pausar ${row.name}`}
                        >
                          <Pause className="text-muted-foreground" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => mudarStatus(row, "active")}
                          aria-label={`Ativar ${row.name}`}
                        >
                          <Play className="text-muted-foreground" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setRemovendo(row)}
                        aria-label={`Remover ${row.name}`}
                      >
                        <Trash2 className="text-muted-foreground" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {rows && rows.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {ativas} automação(ões) ativa(s). O teto é 5 ao mesmo tempo — trava
          barata contra custo inesperado.
        </p>
      ) : null}

      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova automação</DialogTitle>
            <DialogDescription>
              Ela nasce como rascunho: monte o fluxo e ative quando estiver
              pronta.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="automation-name">Nome *</Label>
            <Input
              id="automation-name"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Boas-vindas ao novo parceiro"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNovoAberto(false)}
              disabled={criando}
            >
              Cancelar
            </Button>
            <Button onClick={criar} disabled={criando || !nome.trim()}>
              {criando ? "Criando..." : "Criar e montar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={removendo !== null}
        onOpenChange={(open) => {
          if (!open) setRemovendo(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover automação</DialogTitle>
            <DialogDescription>
              Remover{" "}
              <span className="font-medium text-foreground">
                {removendo?.name}
              </span>{" "}
              apaga o fluxo e os percursos em andamento
              {removendo && removendo.activeRunCount > 0
                ? ` (${removendo.activeRunCount} contato(s) estão dentro agora)`
                : ""}
              . O histórico de envios e o custo já registrado permanecem.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemovendo(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmarRemocao}>
              Remover automação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
