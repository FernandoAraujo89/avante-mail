import type { ReactNode } from "react";

import { AvanteLogo } from "@/components/avante-logo";

// A moldura das páginas públicas da pesquisa: cartão em duas colunas — o
// painel azul da Avante com a chamada e o contexto, e a coluna branca com o
// passo a passo. No celular vira uma coluna: o painel encolhe para um
// cabeçalho e o conteúdo vem logo abaixo.

export function MolduraPublica({
  titulo,
  subtitulo,
  rodape,
  children,
}: {
  titulo: string;
  subtitulo?: string | null;
  /** O cartão do fim do painel (quem responde, quantas perguntas…). */
  rodape?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-secondary/70 p-0 md:p-6 lg:p-10">
      <div className="mx-auto grid min-h-screen w-full max-w-6xl overflow-hidden bg-card shadow-xl md:min-h-[calc(100vh-3rem)] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:rounded-2xl lg:min-h-[calc(100vh-5rem)]">
        <aside className="flex flex-col justify-between bg-primary px-6 py-6 text-primary-foreground md:px-10 md:py-10">
          <div>
            <AvanteLogo type="horizontal" variant="white" height={22} />
            <h1 className="mt-6 text-2xl font-bold leading-tight tracking-tight md:mt-20 md:text-4xl">
              {titulo}
            </h1>
            {subtitulo ? (
              <p className="mt-3 max-w-md text-sm leading-relaxed text-primary-foreground/80 md:mt-5 md:text-base">
                {subtitulo}
              </p>
            ) : null}
          </div>
          {rodape ? <div className="mt-6 hidden md:block">{rodape}</div> : null}
        </aside>

        <main className="flex flex-col px-5 py-6 sm:px-10 sm:py-8 md:px-14 md:py-10">{children}</main>
      </div>
      <p className="py-4 text-center text-xs text-muted-foreground">
        Avante Soluções Digitais · Formiga, MG
      </p>
    </div>
  );
}

/** O cartão translúcido do painel azul (como o depoimento da referência). */
export function CartaoDoPainel({
  titulo,
  linhas,
  passos,
}: {
  titulo: string;
  linhas: string[];
  /** Pontinhos de etapa do painel: quantos e qual está ativo. */
  passos?: { total: number; atual: number };
}) {
  return (
    <div className="rounded-xl bg-white/10 p-5 backdrop-blur-sm">
      <p className="text-base font-semibold">{titulo}</p>
      <ul className="mt-2 grid gap-1 text-sm text-primary-foreground/80">
        {linhas.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {passos ? (
        <div className="mt-4 flex gap-1.5" aria-hidden="true">
          {Array.from({ length: passos.total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full ${i === passos.atual ? "w-5 bg-white" : "w-1.5 bg-white/40"}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
