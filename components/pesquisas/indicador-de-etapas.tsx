import { cn } from "@/lib/utils";

/**
 * As etapas da resposta como pontos ligados por linhas (a referência de
 * cadastro em passos): feitas em azul, a atual com anel, as seguintes apagadas.
 */
export function IndicadorDeEtapas({
  total,
  atual,
  rotulos,
}: {
  total: number;
  /** Índice da etapa atual (0 = a primeira). */
  atual: number;
  /** Nome de cada etapa, para leitores de tela e para o título do ponto. */
  rotulos: string[];
}) {
  return (
    <ol
      className="flex items-center"
      aria-label={`Etapa ${Math.min(atual + 1, total)} de ${total}: ${rotulos[atual] ?? ""}`}
    >
      {Array.from({ length: total }, (_, i) => {
        const feita = i < atual;
        const ativa = i === atual;
        return (
          <li key={i} className={cn("flex items-center", i < total - 1 && "flex-1")} title={rotulos[i]}>
            <span
              aria-current={ativa ? "step" : undefined}
              className={cn(
                "block size-2.5 shrink-0 rounded-full",
                feita && "bg-primary",
                ativa && "bg-card ring-2 ring-primary ring-offset-1 ring-offset-card",
                !feita && !ativa && "bg-border"
              )}
            />
            {i < total - 1 ? (
              <span className={cn("mx-2 h-px flex-1", i < atual ? "bg-primary" : "bg-border")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
