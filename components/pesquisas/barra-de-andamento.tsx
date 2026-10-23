import { andamento, segmentos, type Andamento } from "@/lib/pesquisas/andamento";
import { cn } from "@/lib/utils";

// A barra de andamento da pesquisa: um segmento por situação, do mais
// avançado ao menos. A compacta vai nos cards e nas linhas; a completa, com
// legenda, no acompanhamento.

const COR: Record<ReturnType<typeof segmentos>[number]["chave"], string> = {
  concluidas: "bg-success",
  respondendo: "bg-[#F59E0B]",
  abriram: "bg-primary/60",
  pendentes: "bg-border",
  encerrados: "bg-[#94A3B8]",
};

export function BarraDeAndamento({
  dados,
  compacta = false,
  className,
}: {
  dados: Andamento;
  compacta?: boolean;
  className?: string;
}) {
  const partes = segmentos(dados);
  const rotulo =
    dados.convidados === 0
      ? "Ninguém convidado ainda"
      : `${dados.pctConcluidas}% concluíram (${dados.concluidas} de ${dados.convidados})`;

  return (
    <div className={className}>
      {!compacta ? (
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">Andamento</p>
          <p className="text-xs text-muted-foreground">{rotulo}</p>
        </div>
      ) : null}
      <div
        className={cn("flex w-full overflow-hidden rounded-full bg-muted", compacta ? "h-1.5" : "h-3")}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={dados.pctConcluidas}
        aria-label={rotulo}
        title={rotulo}
      >
        {partes.map((s) => (
          <div
            key={s.chave}
            className={cn("h-full", COR[s.chave])}
            style={{ width: `${s.pct}%` }}
            title={`${s.rotulo}: ${s.valor}`}
          />
        ))}
      </div>
      {!compacta ? (
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          {partes.length === 0 ? <li>Convide parceiros para começar.</li> : null}
          {partes.map((s) => (
            <li key={s.chave} className="flex items-center gap-1.5">
              <span className={cn("inline-block size-2.5 rounded-full", COR[s.chave])} />
              {s.rotulo}: <span className="tabular-nums text-foreground">{s.valor}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Barra de uma só cor: quanto do formulário o parceiro já respondeu. */
export function BarraDeRespostas({ respondidas, total }: { respondidas: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((respondidas / total) * 100);
  return (
    <div className="flex min-w-28 items-center gap-2" title={`${respondidas} de ${total} perguntas`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full", pct === 100 ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {respondidas}/{total}
      </span>
    </div>
  );
}

export { andamento };
