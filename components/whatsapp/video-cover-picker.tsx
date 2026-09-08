"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ImageIcon, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { VIDEO_COVER_STILL_SECONDS } from "@/lib/whatsapp/types";

// Escolha do quadro que vira a capa do vídeo do cabeçalho. O WhatsApp mostra o
// PRIMEIRO quadro como capa e a Cloud API não aceita miniatura, então o
// instante escolhido aqui é regravado parado no início do arquivo (rota
// /api/whatsapp-templates/media/cover). A escolha é feita sempre sobre o
// vídeo original, nunca sobre uma regravação.

/** Passo fino do controle: um quadro a 30 fps. */
const FRAME = 1 / 30;

/** "1:05,3" — minutos, segundos e décimos. */
export function formatInstant(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const whole = Math.floor(total % 60);
  const tenths = Math.floor((total - Math.floor(total)) * 10);
  return `${minutes}:${String(whole).padStart(2, "0")},${tenths}`;
}

interface VideoCoverPickerProps {
  /** Vídeo original (sem capa) — é nele que o instante é escolhido. */
  sourceUrl: string;
  /** Instante já escolhido, em segundos; null = primeiro quadro. */
  coverAt: number | null;
  /** Modelo travado ou upload em andamento: só mostra o estado. */
  disabled?: boolean;
  /** Regravação em andamento. */
  busy?: boolean;
  onPick: (at: number) => void;
  onReset: () => void;
}

export function VideoCoverPicker({
  sourceUrl,
  coverAt,
  disabled,
  busy,
  onPick,
  onReset,
}: VideoCoverPickerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(0);
  const [at, setAt] = useState(coverAt ?? 0);

  // Vídeo trocado: o controle recomeça do instante salvo (ou do zero).
  useEffect(() => {
    setAt(coverAt ?? 0);
    setDuration(0);
  }, [sourceUrl, coverAt]);

  function seek(next: number) {
    const clamped = Math.min(Math.max(next, 0), Math.max(duration - FRAME, 0));
    setAt(clamped);
    const video = videoRef.current;
    if (video) video.currentTime = clamped;
  }

  const status =
    coverAt === null
      ? "Capa: primeiro quadro do vídeo (padrão do WhatsApp)."
      : `Capa: quadro do instante ${formatInstant(coverAt)}.`;

  return (
    <div className="grid gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm">
          <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
          {status}
        </p>
        {!disabled ? (
          <div className="flex flex-wrap gap-2">
            {coverAt !== null ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onReset}
                disabled={busy}
              >
                <RotateCcw />
                Voltar ao primeiro quadro
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen((current) => !current)}
              disabled={busy}
            >
              {open
                ? "Fechar"
                : coverAt === null
                  ? "Escolher a capa"
                  : "Trocar a capa"}
            </Button>
          </div>
        ) : null}
      </div>

      {open && !disabled ? (
        <>
          {/* Sem controles: o quadro é escolhido pela barra abaixo. */}
          <video
            ref={videoRef}
            src={sourceUrl}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setDuration(Number.isFinite(video.duration) ? video.duration : 0);
              video.currentTime = at;
            }}
            className="max-h-56 w-full rounded-md bg-black"
          />
          <input
            type="range"
            min={0}
            max={Math.max(duration - FRAME, 0)}
            step={FRAME}
            value={at}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Instante da capa"
            className="w-full accent-primary"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-14 text-sm tabular-nums">
              {formatInstant(at)}
            </span>
            <div className="flex flex-wrap gap-1">
              <Button type="button" variant="outline" size="sm" onClick={() => seek(at - 1)}>
                −1 s
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => seek(at - FRAME)}>
                −1 quadro
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => seek(at + FRAME)}>
                +1 quadro
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => seek(at + 1)}>
                +1 s
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              onClick={() => onPick(at)}
              disabled={busy || duration === 0}
            >
              <Check />
              {busy ? "Regravando o vídeo..." : "Usar este quadro como capa"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            O WhatsApp usa o primeiro quadro do vídeo como capa e não aceita
            uma imagem à parte. O vídeo é regravado com o quadro escolhido
            parado por {VIDEO_COVER_STILL_SECONDS.toLocaleString("pt-BR")} s no
            início — leva alguns segundos em vídeos longos.
          </p>
        </>
      ) : null}
    </div>
  );
}
