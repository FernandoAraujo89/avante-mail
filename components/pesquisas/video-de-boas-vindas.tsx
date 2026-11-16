"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";

import type { VideoDeBoasVindas as Video } from "@/lib/pesquisas/video";

// O vídeo da boas-vindas da página do parceiro. Começa sozinho e SEM SOM — é
// o único jeito que os navegadores deixam tocar sem toque — com a legenda à
// mostra, e um botão grande "Assistir com som" que volta ao início e liga o
// áudio. Quem pede menos movimento no sistema (prefers-reduced-motion) e o
// iPhone em modo de economia ficam na capa, com o mesmo botão.
//
// O play é disparado no efeito, não pelo atributo autoPlay: o React não
// escreve `muted` no HTML do servidor, e um autoplay sem `muted` é barrado
// antes da hidratação.

export function VideoDeBoasVindas({ video }: { video: Video }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [mudo, setMudo] = useState(true);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Recusado (economia de energia, política do navegador): fica a capa.
    v.play().catch(() => {});
  }, []);

  // Legenda só enquanto está sem som; com áudio, o vídeo fala por si.
  useEffect(() => {
    const faixa = ref.current?.textTracks[0];
    if (faixa) faixa.mode = mudo ? "showing" : "hidden";
  }, [mudo]);

  function assistirComSom() {
    const v = ref.current;
    if (!v) return;
    v.muted = false;
    v.currentTime = 0;
    v.play().catch(() => {});
  }

  return (
    <figure className="min-w-0">
      <div className="relative overflow-hidden rounded-xl bg-black shadow-sm">
        <video
          ref={ref}
          className="block aspect-video w-full"
          poster={video.poster}
          muted
          playsInline
          controls
          preload="auto"
          aria-label={`Vídeo: recado de ${video.autora}`}
          // Os controles nativos também ligam o som: o botão some junto.
          onVolumeChange={(e) => setMudo(e.currentTarget.muted || e.currentTarget.volume === 0)}
          onLoadedMetadata={(e) => {
            const faixa = e.currentTarget.textTracks[0];
            if (faixa) faixa.mode = e.currentTarget.muted ? "showing" : "hidden";
          }}
        >
          <source src={video.src} type="video/mp4" />
          <track kind="captions" src={video.legendas} srcLang="pt-BR" label="Português" default />
        </video>

        {mudo ? (
          <button
            type="button"
            onClick={assistirComSom}
            className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-foreground shadow-lg ring-1 ring-black/5 transition hover:bg-white/90 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none sm:top-4 sm:left-4"
          >
            <Volume2 className="size-4 text-primary" aria-hidden />
            Assistir com som
          </button>
        ) : null}
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground">
        Um recado de {video.autora} · {video.duracao} s
      </figcaption>
    </figure>
  );
}
