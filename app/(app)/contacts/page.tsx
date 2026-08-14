"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { History, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";

import { etapaLabel, type EtapaDto } from "@/components/leads/estagios";
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
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

type ListRef = { id: string; name: string };

type ContactDto = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  tags: string[] | null;
  lists: ListRef[];
  subscribed: boolean;
  whatsappSubscribed: boolean;
  smsSubscribed: boolean;
  /** Estágio do funil; nulo = não é lead (parceiro/contato comum). */
  stage: string | null;
  sourceChannel: string | null;
  createdAt: string;
};

// Trava 3 (docs/plano-webhooks-leads.md, seção 5): lead e parceiro moram na
// mesma tabela, então quem olha a tela precisa CONSEGUIR ver a diferença — sem
// isso, a separação existe só no banco.
//
// As etapas vêm da API, não de constante: elas espelham o funil do Pipedrive.
function filtrosDeEstagio(etapas: EtapaDto[]) {
  return [
    { value: "all", label: "Leads e contatos" },
    { value: "lead", label: "Somente leads" },
    { value: "contato", label: "Somente contatos" },
    ...etapas
      .filter((e) => e.active)
      .map((e) => ({ value: e.slug, label: `Etapa: ${e.label}` })),
  ];
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<ContactDto[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [listFilter, setListFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [availableLists, setAvailableLists] = useState<ListRef[]>([]);
  const [etapas, setEtapas] = useState<EtapaDto[]>([]);
  const [tag, setTag] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ContactDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      setSelected(new Set());
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (listFilter !== "all") params.set("listId", listFilter);
      if (stageFilter !== "all") params.set("stage", stageFilter);
      if (tag.trim()) params.set("tag", tag.trim().toLowerCase());

      const res = await fetch(`/api/contacts?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar contatos.");
      setContacts(json);
    } catch (err) {
      setContacts([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [search, listFilter, stageFilter, tag]);

  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  // Listas e etapas disponíveis para os filtros.
  useEffect(() => {
    (async () => {
      try {
        const [listas, funil] = await Promise.all([
          fetch("/api/lists"),
          fetch("/api/leads/etapas"),
        ]);
        if (listas.ok) setAvailableLists(await listas.json());
        if (funil.ok) {
          const json = await funil.json();
          setEtapas(Array.isArray(json?.etapas) ? json.etapas : []);
        }
      } catch {
        // silencioso: os filtros ficam só com "todas"
      }
    })();
  }, []);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/contacts/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao remover contato.");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  const allSelected =
    !!contacts && contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(() =>
      allSelected ? new Set() : new Set((contacts ?? []).map((c) => c.id))
    );
  }

  async function confirmBulkDelete() {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao remover contatos.");
      setBulkOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBulkOpen(false);
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Contatos"
        description="Parceiros e leads na mesma base. Campanha vai só para quem não é lead; quem tem estágio é nutrido pela área de Leads."
      >
        <Button variant="outline" asChild>
          <Link href="/contacts/import">
            <Upload />
            Importar CSV
          </Link>
        </Button>
        <Button asChild>
          <Link href="/contacts/new">
            <Plus />
            Novo contato
          </Link>
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, e-mail ou empresa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={listFilter} onValueChange={setListFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Lista" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as listas</SelectItem>
            {availableLists.map((list) => (
              <SelectItem key={list.id} value={list.id}>
                {list.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Etapa" />
          </SelectTrigger>
          <SelectContent>
            {filtrosDeEstagio(etapas).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Filtrar por tag..."
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="w-44"
        />
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="mb-3 flex items-center justify-between rounded-lg border bg-accent/50 px-4 py-2">
          <span className="text-sm font-medium">
            {selected.size} contato{selected.size === 1 ? "" : "s"} selecionado
            {selected.size === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              Limpar seleção
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkOpen(true)}
            >
              <Trash2 />
              Excluir selecionados
            </Button>
          </div>
        </div>
      ) : null}

      <Card>
        {contacts === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando contatos...
          </p>
        ) : contacts.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nenhum contato encontrado com os filtros atuais.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos"
                    className="size-4 cursor-pointer accent-primary align-middle"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Listas</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="w-10">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${contact.name}`}
                      className="size-4 cursor-pointer accent-primary align-middle"
                      checked={selected.has(contact.id)}
                      onChange={() => toggleOne(contact.id)}
                    />
                  </TableCell>
                  <TableCell>
                    {/* O estágio fica colado no nome, e não numa coluna
                        própria: a tabela já ocupa a largura toda em 1280px, e
                        uma coluna a mais empurraria as Ações para fora. */}
                    <span className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/contacts/${contact.id}`}
                        className="font-medium hover:underline"
                      >
                        {contact.name}
                      </Link>
                      {contact.stage ? (
                        <Badge variant="info">
                          {etapaLabel(etapas, contact.stage)}
                        </Badge>
                      ) : null}
                    </span>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {contact.email}
                      {contact.phone ? ` · ${formatPhone(contact.phone)}` : ""}
                      {contact.company ? ` · ${contact.company}` : ""}
                      {contact.stage && contact.sourceChannel
                        ? ` · via ${contact.sourceChannel}`
                        : ""}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {contact.lists.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        contact.lists.map((l) => (
                          <Badge key={l.id} variant="secondary">
                            {l.name}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {(contact.tags ?? []).length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        (contact.tags ?? []).map((t) => (
                          <Badge key={t} variant="outline">
                            {t}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {contact.subscribed ? (
                        <Badge variant="success">Ativo</Badge>
                      ) : (
                        <Badge variant="destructive">Descadastrado</Badge>
                      )}
                      {contact.whatsappSubscribed ? (
                        <Badge variant="info">WhatsApp</Badge>
                      ) : null}
                      {contact.smsSubscribed ? (
                        <Badge variant="info">SMS</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(contact.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" asChild>
                        <Link
                          href={`/contacts/${contact.id}`}
                          aria-label={`Ver histórico de ${contact.name}`}
                        >
                          <History className="text-muted-foreground" />
                        </Link>
                      </Button>
                      <Button variant="ghost" size="icon" asChild>
                        <Link
                          href={`/contacts/${contact.id}/edit`}
                          aria-label={`Editar ${contact.name}`}
                        >
                          <Pencil className="text-muted-foreground" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(contact)}
                        aria-label={`Remover ${contact.name}`}
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

      {contacts !== null ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {contacts.length} contato{contacts.length === 1 ? "" : "s"}
        </p>
      ) : null}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover contato</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja remover{" "}
              <span className="font-medium text-foreground">
                {deleteTarget?.name}
              </span>{" "}
              ({deleteTarget?.email})? O histórico de envios dele também será
              apagado.
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
              {deleting ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkOpen}
        onOpenChange={(open) => {
          if (!open) setBulkOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover contatos</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja remover{" "}
              <span className="font-medium text-foreground">
                {selected.size} contato{selected.size === 1 ? "" : "s"}
              </span>
              ? O histórico de envios deles também será apagado. Esta ação não
              pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkOpen(false)}
              disabled={bulkDeleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmBulkDelete}
              disabled={bulkDeleting}
            >
              {bulkDeleting ? "Removendo..." : "Remover selecionados"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
