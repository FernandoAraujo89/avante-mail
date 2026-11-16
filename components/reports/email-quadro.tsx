"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * O e-mail da campanha num quadro que cresce até a altura do próprio e-mail,
 * para a página rolar inteira em vez de ter uma barra de rolagem dentro da
 * outra. Sem allow-scripts: o HTML do e-mail não roda nada dentro do sistema.
 */
export function EmailQuadro({ src, title }: { src: string; title: string }) {
  const quadro = useRef<HTMLIFrameElement>(null);
  const [altura, setAltura] = useState(640);

  const medir = useCallback(() => {
    const doc = quadro.current?.contentDocument;
    if (!doc?.body) return;
    setAltura(
      Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 240)
    );
  }, []);

  // O quadro pode terminar de carregar antes de o React assumir a página —
  // aí o onLoad não dispara e a altura ficaria na inicial.
  useEffect(() => {
    if (quadro.current?.contentDocument?.readyState === "complete") medir();
  }, [medir]);

  return (
    <iframe
      ref={quadro}
      src={src}
      title={title}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="block w-full bg-white"
      style={{ height: altura }}
      onLoad={medir}
    />
  );
}
