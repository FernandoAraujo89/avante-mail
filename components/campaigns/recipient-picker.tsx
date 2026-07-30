"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface RecipientContact {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
}

interface RecipientPickerProps {
  channel: "email" | "whatsapp";
  /** Listas escolhidas no passo. Vazio = todas. */
  lists: string[];
  tags: string[];
  /** null = todos os elegíveis; array = escolha manual (vazio = ninguém). */
  value: string[] | null;
  onChange: (value: string[] | null) => void;
  onEligibleCountChange?: (count: number) => void;
}

// Teto de linhas renderizadas — bases grandes travariam a tela. O que passar
// disso continua selecionado e é avisado embaixo da lista (nunca some calado).
const VISIBLE_LIMIT = 200;

export function RecipientPicker({
  channel,
  lists,
  tags,
  value,
  onChange,
  onEligibleCountChange,
}: RecipientPickerProps) {
  const [contacts, setContacts] = useState<RecipientContact[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  // Callbacks e valor por ref: a lista só é recarregada quando o público muda
  // (canal/listas/tags), não a cada clique numa linha.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onCountRef = useRef(onEligibleCountChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
    onCountRef.current = onEligibleCountChange;
  });

  const listsKey = lists.join(",");
  const tagsKey = tags.join(",");

  useEffect(() => {
    let cancelled = false;
    setContacts(null);
    setError("");

    (async () => {
      try {
        // Mesma elegibilidade do envio: e-mail = inscritos; WhatsApp =
        // telefone + consentimento do canal.
        const params = new URLSearchParams();
        if (channel === "whatsapp") params.set("whatsappEligible", "true");
        else params.set("subscribed", "true");
        if (listsKey) params.set("lists", listsKey);
        if (tagsKey) params.set("tags", tagsKey);

        const res = await fetch(`/api/contacts?${params.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(json.error ?? "Erro ao carregar os contatos.");
        }

        const rows: RecipientContact[] = (
          Array.isArray(json) ? json : []
        ).map((c: RecipientContact) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          company: c.company ?? null,
          phone: c.phone ?? null,
        }));

        setContacts(rows);
        onCountRef.current?.(rows.length);

        // Poda a escolha: quem saiu do público (trocou a lista/tag) não
        // receberia de qualquer jeito — o envio também intersecta no servidor.
        const current = valueRef.current;
        if (current) {
          const ids = new Set(rows.map((c) => c.id));
          const pruned = current.filter((id) => ids.has(id));
          if (pruned.length !== current.length) onChangeRef.current(pruned);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channel, listsKey, tagsKey]);

  const visible = useMemo(() => {
    if (!contacts) return [];
    const term = search.trim().toLowerCase();
    if (!term) return contacts;
    return contacts.filter((c) =>
      [c.name, c.email, c.company ?? "", c.phone ?? ""].some((field) =>
        field.toLowerCase().includes(term)
      )
    );
  }, [contacts, search]);

  const total = contacts?.length ?? 0;
  const selectedCount = value === null ? total : value.length;
  const isSelected = (id: string) => value === null || value.includes(id);

  function toggle(id: string) {
    if (!contacts) return;
    if (value === null) {
      // Estava "todos": passa a ser a lista inteira menos este contato.
      onChange(contacts.filter((c) => c.id !== id).map((c) => c.id));
      return;
    }
    if (value.includes(id)) {
      onChange(value.filter((x) => x !== id));
      return;
    }
    const next = [...value, id];
    // Voltou a ser todo mundo: guarda como "todos" de novo, para que contatos
    // adicionados à lista depois (antes do disparo) também recebam.
    onChange(next.length === contacts.length ? null : next);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {contacts === null ? (
            "Carregando contatos..."
          ) : (
            <>
              <span className="font-medium text-foreground">
                {selectedCount}
              </span>{" "}
              de {total} selecionados
              {value === null ? " (todos)" : null}
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange(null)}
            disabled={contacts === null || value === null}
          >
            Selecionar todos
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([])}
            disabled={contacts === null || selectedCount === 0}
          >
            Desmarcar todos
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, e-mail, empresa ou telefone"
          className="pl-9"
          disabled={contacts === null}
        />
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : contacts !== null && total === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          {channel === "whatsapp"
            ? "Nenhum contato elegível — só quem tem telefone e consentimento de WhatsApp aparece aqui."
            : "Nenhum contato inscrito nas listas escolhidas."}
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
          {visible.slice(0, VISIBLE_LIMIT).map((contact) => {
            const selected = isSelected(contact.id);
            return (
              <button
                key={contact.id}
                type="button"
                onClick={() => toggle(contact.id)}
                aria-pressed={selected}
                className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/50"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40"
                  )}
                >
                  {selected ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {contact.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {channel === "whatsapp"
                      ? (contact.phone ?? "sem telefone")
                      : contact.email}
                    {contact.company ? ` · ${contact.company}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum contato encontrado para “{search}”.
            </p>
          ) : null}
        </div>
      )}

      {visible.length > VISIBLE_LIMIT ? (
        <p className="text-xs text-muted-foreground">
          Mostrando os {VISIBLE_LIMIT} primeiros de {visible.length}. Use a busca
          para encontrar os demais — quem não aparece continua selecionado.
        </p>
      ) : null}
    </div>
  );
}
