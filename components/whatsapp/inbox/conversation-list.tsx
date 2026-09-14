"use client";

import { LoaderCircle, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { formatShortWhen } from "@/lib/format";
import { plainWhatsAppText } from "@/lib/whatsapp/format";
import type { ConversationSummary } from "@/lib/whatsapp/thread-types";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const letters = name
    .replace(/[^\p{L}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (letters.length === 0) return "#";
  const first = letters[0][0];
  const last = letters.length > 1 ? letters.at(-1)![0] : "";
  return `${first}${last}`.toUpperCase();
}

export function ConversationList({
  conversations,
  selectedId,
  search,
  onSearch,
  unreadOnly,
  onUnreadOnly,
  onSelect,
  error,
}: {
  conversations: ConversationSummary[] | null;
  selectedId: string | null;
  search: string;
  onSearch: (value: string) => void;
  unreadOnly: boolean;
  onUnreadOnly: (value: boolean) => void;
  onSelect: (id: string) => void;
  error: string;
}) {
  const filtering = Boolean(search.trim()) || unreadOnly;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid gap-2 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Buscar por nome, empresa ou telefone"
            aria-label="Buscar conversa"
            className="pl-9"
          />
        </div>
        <div
          role="group"
          aria-label="Filtrar conversas"
          className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
        >
          {[
            { value: false, label: "Todas" },
            { value: true, label: "Não lidas" },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={unreadOnly === option.value}
              onClick={() => onUnreadOnly(option.value)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-semibold transition-colors",
                unreadOnly === option.value
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p role="alert" className="p-4 text-sm text-destructive-hover">
            {error}
          </p>
        ) : null}
        {conversations === null && !error ? (
          <div className="flex justify-center p-6 text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" aria-label="Carregando" />
          </div>
        ) : null}
        {conversations?.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {filtering
              ? "Nenhuma conversa corresponde à busca ou ao filtro."
              : "Nenhuma conversa ainda. Quando um contato responder a uma mensagem de WhatsApp, a conversa aparece aqui."}
          </p>
        ) : null}
        <ul>
          {conversations?.map((conversation) => {
            const selected = conversation.id === selectedId;
            const unread = conversation.unreadCount > 0;
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors",
                    selected ? "bg-accent" : "hover:bg-muted"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
                  >
                    {initials(conversation.displayName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-sm",
                          unread ? "font-bold" : "font-medium"
                        )}
                        title={conversation.displayName}
                      >
                        {conversation.displayName}
                      </span>
                      <time
                        dateTime={conversation.lastMessageAt}
                        className={cn(
                          "shrink-0 text-xs",
                          unread ? "font-semibold text-primary" : "text-muted-foreground"
                        )}
                      >
                        {formatShortWhen(conversation.lastMessageAt)}
                      </time>
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-xs",
                          unread ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {conversation.lastMessageDirection === "outbound" ? "Você: " : ""}
                        {plainWhatsAppText(conversation.lastMessagePreview ?? "")}
                      </span>
                      {unread ? (
                        <span
                          className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground"
                          aria-label={`${conversation.unreadCount} não lida(s)`}
                        >
                          {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
