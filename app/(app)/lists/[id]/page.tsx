"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Search, Upload, UserPlus, X } from "lucide-react";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Member = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  subscribed: boolean;
  createdAt: string;
};

type ListInfo = { id: string; name: string; description: string | null };

type ContactOption = {
  id: string;
  name: string;
  email: string;
  lists: { id: string; name: string }[];
};

export default function ListDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [list, setList] = useState<ListInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Diálogo "adicionar contatos existentes".
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<ContactOption[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const res = await fetch(`/api/lists/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar a lista.");
      setList(json.list);
      setMembers(json.contacts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Busca contatos para adicionar (exclui os que já estão na lista).
  useEffect(() => {
    if (!addOpen) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set("search", search.trim());
        const res = await fetch(`/api/contacts?${params.toString()}`);
        const json = await res.json();
        if (!cancelled && res.ok) {
          setOptions(
            json.filter(
              (c: ContactOption) => !c.lists.some((l) => l.id === id)
            )
          );
        }
      } catch {
        // silencioso
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [addOpen, search, id]);

  function togglePick(contactId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  async function handleAdd() {
    if (picked.size === 0) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/lists/${id}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...picked] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao adicionar contatos.");
      setAddOpen(false);
      setPicked(new Set());
      setSearch("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function removeFromList(contactId: string) {
    try {
      const res = await fetch(`/api/lists/${id}/contacts`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [contactId] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao remover da lista.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/lists">
            <ArrowLeft />
            Voltar para listas
          </Link>
        </Button>
        <PageHeader
          title={list?.name ?? "Lista"}
          description={
            list?.description ??
            `${members.length} contato${members.length === 1 ? "" : "s"} nesta lista`
          }
        >
          <Button variant="outline" asChild>
            <Link href={`/contacts/import?listId=${id}`}>
              <Upload />
              Importar CSV
            </Link>
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus />
            Adicionar contatos
          </Button>
        </PageHeader>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}

      <Card>
        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando...
          </p>
        ) : members.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum contato nesta lista ainda.
            </p>
            <Button onClick={() => setAddOpen(true)} variant="outline">
              <Plus />
              Adicionar contatos
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contato</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell>
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="font-medium hover:underline"
                    >
                      {contact.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {contact.email}
                      {contact.company ? ` · ${contact.company}` : ""}
                    </p>
                  </TableCell>
                  <TableCell>
                    {contact.subscribed ? (
                      <Badge variant="success">Ativo</Badge>
                    ) : (
                      <Badge variant="destructive">Descadastrado</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFromList(contact.id)}
                      >
                        <X />
                        Remover da lista
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {members.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {members.length} contato{members.length === 1 ? "" : "s"} nesta lista
        </p>
      ) : null}

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) {
            setPicked(new Set());
            setSearch("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar contatos à lista</DialogTitle>
            <DialogDescription>
              Selecione contatos existentes. Para trazer novos por arquivo, use
              &quot;Importar CSV&quot;.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, e-mail ou empresa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
            {options.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhum contato disponível para adicionar.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {options.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary"
                        checked={picked.has(c.id)}
                        onChange={() => togglePick(c.id)}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.email}
                        </p>
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddOpen(false)}
              disabled={adding}
            >
              Cancelar
            </Button>
            <Button onClick={handleAdd} disabled={adding || picked.size === 0}>
              {adding
                ? "Adicionando..."
                : `Adicionar${picked.size > 0 ? ` (${picked.size})` : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
