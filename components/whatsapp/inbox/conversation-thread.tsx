"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Info,
  LoaderCircle,
  Lock,
  SendHorizontal,
  UserRound,
} from "lucide-react";

import { ThreadBubble } from "@/components/whatsapp/inbox/message-bubble";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { dayKey, formatDateTime, formatDayLabel } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { WHATSAPP_TEXT_MAX } from "@/lib/whatsapp/inbound";
import type {
  ConversationThread as Thread,
  ThreadMessage,
} from "@/lib/whatsapp/thread-types";
import { cn } from "@/lib/utils";

/** Com a conversa aberta e visível, novas mensagens aparecem neste intervalo. */
const POLL_MS = 5_000;
/** Distância do fim (px) em que a conversa ainda acompanha a mensagem nova. */
const NEAR_BOTTOM_PX = 160;

function closesIn(closesAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((new Date(closesAt).getTime() - now) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}min` : `${hours}h`;
}

export function ConversationThread({
  id,
  onBack,
  onRead,
  onSent,
}: {
  id: string;
  /** Volta para a lista (só aparece na tela estreita). */
  onBack: () => void;
  /** A conversa foi marcada como lida — a lista e o menu atualizam o número. */
  onRead: (id: string) => void;
  /** A equipe respondeu — a lista reordena. */
  onSent: () => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [loadError, setLoadError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [pending, setPending] = useState<ThreadMessage | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const lastItemKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/conversations/${id}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar a conversa.");
      const data = json as Thread;
      setThread(data);
      setLoadError("");
      // Abrir a conversa é ler: zera o número na lista e no menu. Só com a aba
      // visível — polling em aba escondida não é leitura de ninguém.
      if (
        data.conversation.unreadCount > 0 &&
        document.visibilityState === "visible"
      ) {
        fetch(`/api/whatsapp/conversations/${id}/read`, { method: "POST" })
          .then((r) => {
            if (r.ok) onRead(id);
          })
          .catch(() => {});
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [id, onRead]);

  useEffect(() => {
    load();
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  // O "fecha em 3h 20min" da janela anda sozinho.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const items = thread ? [...thread.items, ...(pending ? [pending] : [])] : [];
  const itemsKey = items.length > 0 ? `${items.length}:${items.at(-1)!.id}` : null;

  // Conversa nova ou mensagem nova: desce até o fim — a não ser que a pessoa
  // tenha subido para ler o histórico, que aí não é interrompida.
  useLayoutEffect(() => {
    if (!itemsKey || itemsKey === lastItemKey.current) return;
    const first = lastItemKey.current === null;
    lastItemKey.current = itemsKey;
    const el = scrollRef.current;
    if (el && (first || stickToBottom.current)) {
      el.scrollTop = el.scrollHeight;
    }
  }, [itemsKey]);

  // Foto e vídeo terminam de carregar DEPOIS de a conversa descer até o fim, e
  // empurram o fim para baixo. Quem estava no fim continua no fim. (A área das
  // mensagens só existe depois do primeiro carregamento.)
  const loaded = thread !== null;
  useEffect(() => {
    const content = contentRef.current;
    const el = scrollRef.current;
    if (!content || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [loaded]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const message = text.trim();
    if (!message || sending) return;

    setSending(true);
    setSendError("");
    stickToBottom.current = true;
    setPending({
      kind: "message",
      id: `enviando-${Date.now()}`,
      direction: "outbound",
      type: "text",
      body: message,
      hasMedia: false,
      mediaMimeType: null,
      mediaFilename: null,
      status: "pending",
      errorCode: null,
      errorMessage: null,
      sentByName: null,
      at: new Date().toISOString(),
      quoted: null,
    });
    setText("");
    requestAnimationFrame(autoGrow);

    try {
      const res = await fetch(`/api/whatsapp/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(json.error ?? "Não foi possível enviar a mensagem.");
        // Sem registro no servidor (janela fechada, texto inválido): o texto
        // volta para a caixa em vez de sumir. Com registro, o balão com a
        // falha já mostra o que foi escrito.
        if (!json.message) setText(message);
      }
    } catch {
      setSendError("Sem conexão com o servidor. A mensagem não foi enviada.");
      setText(message);
    } finally {
      await load();
      setPending(null);
      setSending(false);
      onSent();
      requestAnimationFrame(() => {
        autoGrow();
        textareaRef.current?.focus();
      });
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Como no WhatsApp Web: Enter envia, Shift+Enter quebra a linha. No
    // celular o Enter do teclado continua quebrando linha (há o botão).
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      window.matchMedia("(pointer: fine)").matches
    ) {
      event.preventDefault();
      send();
    }
  }

  if (!thread) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {loadError ? (
          <div className="grid justify-items-center gap-3 text-center">
            <p className="text-destructive-hover">{loadError}</p>
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft />
              Voltar para as conversas
            </Button>
          </div>
        ) : (
          <LoaderCircle className="size-5 animate-spin" aria-label="Carregando" />
        )}
      </div>
    );
  }

  const { conversation, window: serviceWindow, canSend } = thread;
  const phone = formatPhone(conversation.phone);
  const canWrite = canSend && serviceWindow.open;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2.5 @2xl:px-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Voltar para as conversas"
          className="-ml-1 shrink-0 @2xl:hidden"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-base font-semibold"
            title={conversation.displayName}
          >
            {conversation.displayName}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {[
              conversation.displayName !== phone ? phone : null,
              conversation.company,
              // Sem contato, o nome no topo é o do perfil do WhatsApp — que
              // a pessoa escolhe e pode ser qualquer coisa.
              !conversation.contactId ? "Fora da base de contatos" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {conversation.optedOut ? (
          <Badge
            variant="warning"
            className="hidden @md:inline-flex"
            title="Pediu para sair: não recebe mais campanha. Responder ao que ele escrever continua permitido."
          >
            Saiu das campanhas
          </Badge>
        ) : null}
        {conversation.contactId ? (
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href={`/contacts/${conversation.contactId}`}>
              <UserRound />
              <span className="hidden @lg:inline">Ver contato</span>
            </Link>
          </Button>
        ) : null}
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto bg-[#efeae2] px-3 py-4 @2xl:px-6"
      >
        <div ref={contentRef} className="mx-auto grid max-w-3xl gap-1.5">
          {items.map((item, index) => {
            const previous = items[index - 1];
            const newDay = !previous || dayKey(previous.at) !== dayKey(item.at);
            return (
              <Fragment key={item.id}>
                {newDay ? (
                  <p className="my-2 justify-self-center rounded-md bg-white/90 px-3 py-1 text-xs font-medium text-[#54656f] shadow-sm">
                    {formatDayLabel(item.at, new Date(now))}
                  </p>
                ) : null}
                <ThreadBubble item={item} />
              </Fragment>
            );
          })}
          {items.length === 0 ? (
            <p className="justify-self-center rounded-md bg-white/90 px-3 py-2 text-sm text-[#54656f]">
              Nenhuma mensagem nesta conversa.
            </p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border bg-card px-3 py-2.5 @2xl:px-4">
        {!canSend ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            O canal WhatsApp não está configurado neste servidor: dá para ler a
            conversa, mas não para responder.
          </p>
        ) : !serviceWindow.open ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Lock className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-semibold text-foreground">
                Janela de 24h fechada.
              </span>{" "}
              O WhatsApp só aceita resposta livre até 24 horas depois da última
              mensagem do contato
              {conversation.lastInboundAt
                ? ` (${formatDateTime(conversation.lastInboundAt)})`
                : ""}
              . Para retomar, envie um modelo aprovado por uma campanha — a
              conversa reabre quando ele responder.
            </span>
          </p>
        ) : null}

        {canWrite ? (
          <form onSubmit={send} className="grid gap-1.5">
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  autoGrow();
                }}
                onKeyDown={onKeyDown}
                rows={1}
                maxLength={WHATSAPP_TEXT_MAX}
                placeholder="Escreva a resposta"
                aria-label="Resposta para o contato"
                className="max-h-40 min-h-9 resize-none py-2"
              />
              <Button
                type="submit"
                size="icon"
                disabled={sending || !text.trim()}
                aria-label="Enviar resposta"
                className="shrink-0"
              >
                {sending ? <LoaderCircle className="animate-spin" /> : <SendHorizontal />}
              </Button>
            </div>
            <p className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span>
                Janela aberta: fecha em{" "}
                {serviceWindow.closesAt ? closesIn(serviceWindow.closesAt, now) : "—"}.
                Resposta dentro dela não é cobrada.
              </span>
              {text.length > WHATSAPP_TEXT_MAX - 500 ? (
                <span className={cn(text.length >= WHATSAPP_TEXT_MAX && "text-destructive-hover")}>
                  {text.length}/{WHATSAPP_TEXT_MAX}
                </span>
              ) : (
                <span className="hidden [@media(pointer:fine)]:inline">
                  Enter envia · Shift+Enter quebra a linha
                </span>
              )}
            </p>
          </form>
        ) : null}

        {sendError ? (
          <p role="alert" className="mt-1.5 text-sm text-destructive-hover">
            {sendError}
          </p>
        ) : null}
        {loadError ? (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Não foi possível atualizar a conversa agora: {loadError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
