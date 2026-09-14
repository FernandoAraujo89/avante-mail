"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  ExternalLink,
  FileText,
  Megaphone,
  MousePointerClick,
  Workflow,
} from "lucide-react";

import { WhatsAppText } from "@/components/whatsapp/whatsapp-text";
import { formatTime } from "@/lib/format";
import { describeWhatsAppError } from "@/lib/whatsapp/errors";
import { messagePreview } from "@/lib/whatsapp/inbound";
import type {
  ThreadItem,
  ThreadMessage,
  ThreadTemplate,
} from "@/lib/whatsapp/thread-types";
import { cn } from "@/lib/utils";

// Balões da conversa. As cores são as do WhatsApp, fixas e independentes do
// tema, como em bubble-preview.tsx: a equipe precisa reconhecer de relance o
// que o contato viu. O texto miúdo usa #54656f (e não o #8696a0 do app) para
// manter contraste legível sobre o verde.

const STATUS_LABELS: Record<string, string> = {
  pending: "Enviando",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Não entregue",
};

function StatusIcon({ status }: { status: string | null }) {
  const label = STATUS_LABELS[status ?? ""] ?? "";
  const className = "size-3.5 shrink-0";
  if (status === "pending") {
    return <Clock className={className} aria-label={label} />;
  }
  if (status === "sent") {
    return <Check className={className} aria-label={label} />;
  }
  if (status === "delivered") {
    return <CheckCheck className={className} aria-label={label} />;
  }
  if (status === "read") {
    return (
      <CheckCheck className={cn(className, "text-[#027eb5]")} aria-label={label} />
    );
  }
  if (status === "failed") {
    return (
      <CircleAlert
        className={cn(className, "text-destructive-hover")}
        aria-label={label}
      />
    );
  }
  return null;
}

function FailureNote({
  errorCode,
  errorMessage,
}: {
  errorCode: string | null;
  errorMessage: string | null;
}) {
  const info = describeWhatsAppError(errorCode, errorMessage);
  return (
    <p className="mt-1 border-t border-black/10 pt-1 text-xs text-destructive-hover">
      <span className="font-semibold">{info.label}.</span> {info.explanation}
    </p>
  );
}

/** Foto, áudio, vídeo ou documento do contato, buscados na Meta pelo servidor. */
function InboundMedia({ item }: { item: ThreadMessage }) {
  const [unavailable, setUnavailable] = useState(false);
  const src = `/api/whatsapp/media/${item.id}`;

  if (unavailable) {
    return (
      <p className="mb-1 rounded-md bg-black/5 px-2 py-1.5 text-xs text-[#54656f]">
        {messagePreview({ type: item.type, body: null })} — o arquivo não está
        mais disponível na Meta.
      </p>
    );
  }
  if (item.type === "image" || item.type === "sticker") {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="mb-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={item.type === "sticker" ? "Figurinha" : "Foto enviada pelo contato"}
          loading="lazy"
          onError={() => setUnavailable(true)}
          className={cn(
            "rounded-md object-cover",
            item.type === "sticker" ? "size-28" : "max-h-72 w-full"
          )}
        />
      </a>
    );
  }
  if (item.type === "audio") {
    return (
      <audio
        controls
        preload="none"
        src={src}
        onError={() => setUnavailable(true)}
        className="mb-1 h-10 w-64 max-w-full"
      />
    );
  }
  if (item.type === "video") {
    return (
      <video
        controls
        preload="none"
        src={src}
        onError={() => setUnavailable(true)}
        className="mb-1 max-h-72 w-full rounded-md bg-black"
      />
    );
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1 flex min-w-0 items-center gap-2 rounded-md bg-black/5 p-2.5 hover:bg-black/10"
    >
      <FileText className="size-6 shrink-0 text-[#d93025]" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-[#111b21]">
          {item.mediaFilename ?? "Documento"}
        </span>
        <span className="block text-[10px] uppercase text-[#54656f]">
          Abrir arquivo
        </span>
      </span>
    </a>
  );
}

function MessageBubble({ item }: { item: ThreadMessage }) {
  const outbound = item.direction === "outbound";

  if (item.type === "reaction") {
    return (
      <div className="flex justify-start">
        <p className="rounded-full bg-white/80 px-3 py-1 text-xs text-[#54656f] shadow-sm">
          {item.body
            ? `Reagiu ${item.body} a uma mensagem`
            : "Retirou a reação de uma mensagem"}{" "}
          · {formatTime(item.at)}
        </p>
      </div>
    );
  }

  // Toque de botão é do contato; "interactive" nosso é a resposta automática.
  const isButton =
    !outbound && (item.type === "button" || item.type === "interactive");
  const fallback =
    !item.body && !item.hasMedia ? messagePreview({ type: item.type, body: null }) : null;

  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0 max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm @xl:max-w-[70%]",
          outbound ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white"
        )}
      >
        {item.quoted ? (
          <p className="mb-1 line-clamp-3 rounded-md border-l-4 border-[#06cf9c] bg-black/5 px-2 py-1 text-xs text-[#54656f]">
            {item.quoted}
          </p>
        ) : null}
        {isButton ? (
          <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-[#54656f]">
            <MousePointerClick className="size-3" aria-hidden="true" />
            Resposta pelo botão
          </p>
        ) : null}
        {item.hasMedia ? <InboundMedia item={item} /> : null}
        {item.body ? (
          <p
            className={cn(
              "whitespace-pre-wrap break-words text-[#111b21]",
              isButton && "font-semibold"
            )}
          >
            <WhatsAppText text={item.body} />
          </p>
        ) : null}
        {fallback ? <p className="italic text-[#54656f]">{fallback}</p> : null}
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[#54656f]">
          {outbound && item.sentByName ? (
            <span className="min-w-0 truncate" title={item.sentByName}>
              {item.sentByName} ·
            </span>
          ) : null}
          <time dateTime={item.at}>{formatTime(item.at)}</time>
          {outbound ? <StatusIcon status={item.status} /> : null}
        </p>
        {item.cta ? (
          // Como o WhatsApp mostra o botão de link: uma faixa no pé do balão.
          <a
            href={item.cta.url}
            target="_blank"
            rel="noopener noreferrer"
            className="-mx-2.5 -mb-1.5 mt-1 flex items-center justify-center gap-1 border-t border-black/10 px-2.5 py-2 text-sm font-medium text-[#027eb5] hover:bg-black/5"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            {item.cta.text}
          </a>
        ) : null}
        {outbound && item.status === "failed" ? (
          <FailureNote errorCode={item.errorCode} errorMessage={item.errorMessage} />
        ) : null}
      </div>
    </div>
  );
}

function TemplateBubble({ item }: { item: ThreadTemplate }) {
  const OriginIcon = item.origin?.type === "automation" ? Workflow : Megaphone;
  const originHref = item.origin
    ? `/${item.origin.type === "automation" ? "automations" : "campaigns"}/${item.origin.id}/report`
    : null;

  return (
    <div className="flex justify-end">
      <div className="min-w-0 max-w-[85%] @xl:max-w-[70%]">
        <div className="rounded-lg rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 text-sm shadow-sm">
          <p className="mb-1 flex min-w-0 items-center gap-1 text-[11px] font-semibold text-[#54656f]">
            <OriginIcon className="size-3 shrink-0" aria-hidden="true" />
            <span className="shrink-0">
              {item.origin?.type === "automation" ? "Automação:" : "Campanha:"}
            </span>
            {originHref ? (
              <Link
                href={originHref}
                className="min-w-0 truncate underline-offset-2 hover:underline"
                title={item.origin?.name}
              >
                {item.origin?.name || "sem nome"}
              </Link>
            ) : (
              <span>envio sem origem registrada</span>
            )}
          </p>
          {item.headerMedia?.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.headerMedia.url}
              alt=""
              loading="lazy"
              className="mb-1 max-h-48 w-full rounded-md object-cover"
            />
          ) : null}
          {item.headerMedia?.kind === "video" ? (
            <video
              src={item.headerMedia.url}
              controls
              preload="none"
              className="mb-1 max-h-48 w-full rounded-md bg-black"
            />
          ) : null}
          {item.headerMedia?.kind === "document" ? (
            <div className="mb-1 flex min-w-0 items-center gap-2 rounded-md bg-black/5 p-2.5">
              <FileText className="size-6 shrink-0 text-[#d93025]" />
              <span className="truncate text-xs font-medium text-[#111b21]">
                {item.headerMedia.filename ?? "documento.pdf"}
              </span>
            </div>
          ) : null}
          {item.headerText ? (
            <p className="mb-0.5 font-semibold text-[#111b21]">{item.headerText}</p>
          ) : null}
          <p className="whitespace-pre-wrap break-words text-[#111b21]">
            <WhatsAppText text={item.bodyText} />
          </p>
          {item.footerText ? (
            <p className="mt-1 text-xs text-[#54656f]">{item.footerText}</p>
          ) : null}
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[#54656f]">
            <time dateTime={item.at}>{formatTime(item.at)}</time>
            <StatusIcon status={item.status} />
          </p>
          {item.status === "failed" ? (
            <FailureNote errorCode={item.errorCode} errorMessage={item.errorMessage} />
          ) : null}
        </div>
        {item.buttons.length > 0 ? (
          <ul className="mt-1 grid gap-1" aria-label="Botões do modelo">
            {item.buttons.map((text) => {
              const tapped = item.replyButton === text;
              return (
                <li
                  key={text}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg bg-white/90 px-2 py-1.5 text-center text-sm font-medium text-[#027eb5] shadow-sm",
                    tapped && "ring-2 ring-[#06cf9c]"
                  )}
                >
                  <span className="min-w-0 truncate">{text}</span>
                  {tapped ? (
                    <span className="shrink-0 rounded-sm bg-[#06cf9c]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#0b6b52]">
                      tocado
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function ThreadBubble({ item }: { item: ThreadItem }) {
  return item.kind === "template" ? (
    <TemplateBubble item={item} />
  ) : (
    <MessageBubble item={item} />
  );
}
