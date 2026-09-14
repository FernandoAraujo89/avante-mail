"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MessagesSquare } from "lucide-react";

import { AutoReplySettingsButton } from "@/components/whatsapp/inbox/auto-reply-settings";
import { ConversationList } from "@/components/whatsapp/inbox/conversation-list";
import { ConversationThread } from "@/components/whatsapp/inbox/conversation-thread";
import { UNREAD_CHANGED_EVENT } from "@/lib/whatsapp/inbox-events";
import type { ConversationSummary } from "@/lib/whatsapp/thread-types";
import { cn } from "@/lib/utils";

/** A lista acompanha as conversas novas neste intervalo (com a aba visível). */
const LIST_POLL_MS = 10_000;

/**
 * Caixa de conversas do WhatsApp. A conversa aberta mora na URL (?c=id): o
 * voltar do navegador fecha a conversa no celular, e o link pode ser copiado
 * do relatório da campanha ou da ficha do contato.
 *
 * O layout de dois painéis depende da largura DA CAIXA (container query), não
 * da janela: com o menu lateral aberto, uma janela de 1024px sobra ~720px
 * para cá, e dois painéis ali ficariam espremidos.
 */
export function ConversationsInbox() {
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("c");
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(
    null
  );
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (unreadOnly) params.set("unread", "1");
    try {
      const res = await fetch(`/api/whatsapp/conversations?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar as conversas.");
      setConversations(json.conversations);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [search, unreadOnly]);

  // Busca com respiro de digitação; atualização periódica com a aba visível.
  useEffect(() => {
    const timer = setTimeout(loadList, 250);
    return () => clearTimeout(timer);
  }, [loadList]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") loadList();
    };
    const timer = setInterval(refresh, LIST_POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadList]);

  function select(id: string | null) {
    window.history.pushState(null, "", id ? `/conversations?c=${id}` : "/conversations");
  }

  const handleRead = useCallback((id: string) => {
    setConversations((current) =>
      current?.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)) ?? current
    );
    window.dispatchEvent(new Event(UNREAD_CHANGED_EVENT));
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Na tela estreita, com uma conversa aberta, o título cede o espaço. */}
      <div
        className={cn(
          "mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2",
          selectedId && "hidden md:flex"
        )}
      >
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Conversas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            O que os contatos respondem no WhatsApp. Até 24h depois da última
            mensagem do contato, dá para responder por aqui.
          </p>
        </div>
        <AutoReplySettingsButton />
      </div>

      <div className="@container flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div
          className={cn(
            "min-h-0 min-w-0 flex-col @2xl:flex @2xl:w-80 @2xl:shrink-0 @2xl:border-r @2xl:border-border",
            selectedId ? "hidden" : "flex w-full"
          )}
        >
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            search={search}
            onSearch={setSearch}
            unreadOnly={unreadOnly}
            onUnreadOnly={setUnreadOnly}
            onSelect={select}
            error={error}
          />
        </div>

        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col @2xl:flex",
            selectedId ? "flex" : "hidden"
          )}
        >
          {selectedId ? (
            <ConversationThread
              key={selectedId}
              id={selectedId}
              onBack={() => select(null)}
              onRead={handleRead}
              onSent={loadList}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-muted/40 p-8 text-center text-sm text-muted-foreground">
              <MessagesSquare className="size-8 text-primary/60" aria-hidden="true" />
              <p>Escolha uma conversa para ler e responder.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
