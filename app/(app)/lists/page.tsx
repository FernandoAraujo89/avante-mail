"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ListChecks, Pencil, Plus, Trash2, Users } from "lucide-react";

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
import { formatDate } from "@/lib/format";

type ListDto = {
  id: string;
  name: string;
  description: string | null;
  contactCount: number;
  createdAt: string;
};

export default function ListsPage() {
  const [lists, setLists] = useState<ListDto[] | null>(null);
  const [error, setError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ListDto | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ListDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const res = await fetch("/api/lists");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar listas.");
      setLists(json);
    } catch (err) {
      setLists([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setName("");
    setDescription("");
    setFormOpen(true);
  }

  function openEdit(list: ListDto) {
    setEditing(list);
    setName(list.name);
    setDescription(list.description ?? "");
    setFormOpen(true);
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        editing ? `/api/lists/${editing.id}` : "/api/lists",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar a lista.");
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFormOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/lists/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao remover a lista.");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Listas"
        description="Organize os contatos em listas para direcionar as campanhas."
      >
        <Button onClick={openCreate}>
          <Plus />
          Nova lista
        </Button>
      </PageHeader>

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}

      <Card>
        {lists === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando listas...
          </p>
        ) : lists.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <ListChecks className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhuma lista ainda. Crie a primeira para começar a organizar os
              contatos.
            </p>
            <Button onClick={openCreate} variant="outline">
              <Plus />
              Nova lista
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lista</TableHead>
                <TableHead>Contatos</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.map((list) => (
                <TableRow key={list.id}>
                  <TableCell>
                    <Link
                      href={`/lists/${list.id}`}
                      className="font-medium hover:underline"
                    >
                      {list.name}
                    </Link>
                    {list.description ? (
                      <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">
                        {list.description}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="size-3.5" />
                      {list.contactCount}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(list.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(list)}
                        aria-label={`Editar ${list.name}`}
                      >
                        <Pencil className="text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(list)}
                        aria-label={`Remover ${list.name}`}
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

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar lista" : "Nova lista"}</DialogTitle>
            <DialogDescription>
              Listas agrupam contatos para direcionar as campanhas.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="list-name">Nome *</Label>
              <Input
                id="list-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Leads do Site"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="list-description">Descrição</Label>
              <Input
                id="list-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Opcional — de onde vêm esses contatos"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover lista</DialogTitle>
            <DialogDescription>
              Remover a lista{" "}
              <span className="font-medium text-foreground">
                {deleteTarget?.name}
              </span>{" "}
              não apaga os contatos — apenas desfaz a associação com esta lista.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Removendo..." : "Remover lista"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
