"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";

import {
  PlanilhaFilterDialog,
  type PlanilhaFilterResult,
} from "@/components/campaigns/planilha-filter-dialog";
import { Paginacao, usePaginacao } from "@/components/paginacao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface RecipientContact {
  id: string;
  name: string;
  /** Principal; nulo = contato só com telefone. */
  email: string | null;
  company: string | null;
  phone: string | null;
  /** Todos os e-mails e telefones (o filtro por planilha olha todos). */
  emails: string[];
  phones: string[];
  /** Quantos endereços deste contato aceitam o canal: é o que ele recebe. */
  eligibleAddresses: number;
  lists: { id: string; name: string }[];
}

interface RecipientPickerProps {
  channel: "email" | "whatsapp" | "sms";
  /** Listas escolhidas no passo. Vazio = todas. */
  lists: string[];
  /** Nomes das listas escolhidas, só para exibição. */
  listNames: string[];
  tags: string[];
  /** null = todos os elegíveis; array = escolha manual (vazio = ninguém). */
  value: string[] | null;
  onChange: (value: string[] | null) => void;
  onEligibleCountChange?: (count: number) => void;
  /**
   * Quantas MENSAGENS a escolha atual gera (um contato com dois telefones
   * conta dois). null enquanto a lista carrega.
   */
  onSelectedMessagesChange?: (messages: number | null) => void;
}

export function RecipientPicker({
  channel,
  lists,
  listNames,
  tags,
  value,
  onChange,
  onEligibleCountChange,
  onSelectedMessagesChange,
}: RecipientPickerProps) {
  const [contacts, setContacts] = useState<RecipientContact[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  // Resumo do último filtro por planilha, para o usuário não perder de vista
  // o que a seleção atual significa depois de fechar a janela.
  const [filtro, setFiltro] = useState<PlanilhaFilterResult | null>(null);

  // Callbacks e valor por ref: a lista só é recarregada quando o público muda
  // (canal/listas/tags), não a cada clique numa linha.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onCountRef = useRef(onEligibleCountChange);
  const onMessagesRef = useRef(onSelectedMessagesChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
    onCountRef.current = onEligibleCountChange;
    onMessagesRef.current = onSelectedMessagesChange;
  });

  // Mensagens da escolha atual: soma dos endereços que aceitam o canal.
  useEffect(() => {
    if (!contacts) {
      onMessagesRef.current?.(null);
      return;
    }
    const escolhidos =
      value === null ? contacts : contacts.filter((c) => value.includes(c.id));
    onMessagesRef.current?.(
      escolhidos.reduce((soma, c) => soma + (c.eligibleAddresses || 1), 0)
    );
  }, [contacts, value]);

  const listsKey = lists.join(",");
  const tagsKey = tags.join(",");

  useEffect(() => {
    let cancelled = false;
    setContacts(null);
    setError("");

    (async () => {
      try {
        // Mesma elegibilidade do envio: e-mail = inscritos; WhatsApp e SMS =
        // telefone + consentimento do respectivo canal (aceites separados).
        const params = new URLSearchParams();
        if (channel === "whatsapp") params.set("whatsappEligible", "true");
        else if (channel === "sms") params.set("smsEligible", "true");
        else params.set("subscribed", "true");
        if (listsKey) params.set("lists", listsKey);
        if (tagsKey) params.set("tags", tagsKey);
        // Mesma regra do envio: lead não é público de campanha, então não
        // aparece aqui nem para ser marcado à mão.
        params.set("leads", "exclude");

        const res = await fetch(`/api/contacts?${params.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(json.error ?? "Erro ao carregar os contatos.");
        }

        const rows: RecipientContact[] = (Array.isArray(json) ? json : []).map(
          (c: RecipientContact) => ({
            id: c.id,
            name: c.name,
            email: c.email ?? null,
            company: c.company ?? null,
            phone: c.phone ?? null,
            emails: Array.isArray(c.emails) ? c.emails : [],
            phones: Array.isArray(c.phones) ? c.phones : [],
            eligibleAddresses:
              typeof c.eligibleAddresses === "number" ? c.eligibleAddresses : 1,
            lists: Array.isArray(c.lists) ? c.lists : [],
          })
        );

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
      [c.name, c.email ?? "", c.company ?? "", ...c.phones].some((field) =>
        field.toLowerCase().includes(term)
      )
    );
  }, [contacts, search]);

  const total = contacts?.length ?? 0;
  const selectedCount = value === null ? total : value.length;
  const isSelected = (id: string) => value === null || value.includes(id);

  // Buscar ou trocar o público joga de volta para a primeira página.
  const {
    itensDaPagina: pageRows,
    ancora,
    paginacao,
  } = usePaginacao(visible, {
    chave: "destinatarios",
    redefinirCom: [search, channel, listsKey, tagsKey],
  });

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

  const origem =
    listNames.length > 0
      ? `Contatos de ${listNames.join(", ")}`
      : "Contatos de todas as listas";

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        {origem}
        {tags.length > 0 ? ` · tags: ${tags.join(", ")}` : ""}
      </p>

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
        <div className="flex flex-wrap gap-2">
          {/* A planilha do comercial vale para qualquer canal: o diálogo só
              cruza o que já está cadastrado (por e-mail, telefone ou nome). */}
          <PlanilhaFilterDialog
            channel={channel}
            contacts={contacts}
            onApply={(ids, resultado) => {
              onChange(ids);
              setFiltro(resultado);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onChange(null);
              setFiltro(null);
            }}
            disabled={contacts === null || value === null}
          >
            Selecionar todos
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onChange([]);
              setFiltro(null);
            }}
            disabled={contacts === null || selectedCount === 0}
          >
            Desmarcar todos
          </Button>
        </div>
      </div>

      {filtro ? (
        <p className="rounded-lg border border-border bg-accent/50 px-3 py-2 text-xs">
          Filtrado por planilha:{" "}
          <span className="font-medium">
            {filtro.encontradas} de {filtro.total}
          </span>{" "}
          linhas encontradas
          {filtro.naoEncontradas.length > 0 ? (
            <>
              {" "}
              ·{" "}
              <span className="font-medium text-destructive-hover">
                {filtro.naoEncontradas.length} não encontrada
                {filtro.naoEncontradas.length === 1 ? "" : "s"}
              </span>{" "}
              (abra o filtro para ver quais)
            </>
          ) : null}
          {filtro.nomesAmbiguos.length > 0 ? (
            <>
              {" "}
              ·{" "}
              <span className="font-medium">
                {filtro.nomesAmbiguos.length} nome
                {filtro.nomesAmbiguos.length === 1 ? "" : "s"} com mais de um
                contato
              </span>
            </>
          ) : null}
        </p>
      ) : null}

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
            : channel === "sms"
              ? "Nenhum contato elegível — só quem tem celular e consentimento de SMS aparece aqui."
              : "Nenhum contato inscrito nas listas escolhidas."}
        </p>
      ) : (
        // Altura limitada: com 100 por página a lista rolaria a tela inteira.
        <div
          ref={ancora}
          className="max-h-[28rem] overflow-y-auto rounded-lg border border-border"
        >
          {pageRows.map((contact) => {
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
                    {channel === "email"
                      ? (contact.email ?? "sem e-mail")
                      : (contact.phone ?? "sem telefone")}
                    {/* Recebe em mais de um endereço: cada um é uma mensagem. */}
                    {contact.eligibleAddresses > 1
                      ? ` (+${contact.eligibleAddresses - 1} ${
                          channel === "email" ? "e-mail" : "número"
                        }${contact.eligibleAddresses > 2 ? "s" : ""})`
                      : ""}
                    {contact.company ? ` · ${contact.company}` : ""}
                    {contact.lists.length > 0
                      ? ` · ${contact.lists.map((l) => l.name).join(", ")}`
                      : ""}
                  </span>
                </span>
              </button>
            );
          })}
          {pageRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum contato encontrado para “{search}”.
            </p>
          ) : null}
        </div>
      )}

      {contacts !== null ? (
        <Paginacao {...paginacao} totalSemFiltro={total} />
      ) : null}
    </div>
  );
}
