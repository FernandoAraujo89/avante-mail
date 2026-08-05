import { faixaInfo } from "@/components/leads/estagios";

/**
 * A barra de calor do lead — "o quão aquecido ele está", de relance.
 *
 * DUAS DECISÕES QUE GOVERNAM A LEITURA:
 *
 * 1. A escala termina no limiar de QUENTE, que é o topo da régua. Um lead que
 *    chega lá enche a barra; acima disso ela fica cheia, porque a pergunta
 *    "quão perto ele está do topo" já foi respondida.
 *
 * 2. As paradas do degradê ficam nos LIMIARES REAIS, não em frações fixas.
 *    Assim a cor no ponto do lead e o rótulo da faixa nunca se contradizem: a
 *    ponta da barra de um lead "aquecido" está no laranja porque o laranja
 *    COMEÇA no limiar de aquecido. Se as paradas fossem fixas, mudar um corte
 *    na tela de Pontuação faria cor e rótulo divergirem em silêncio.
 */

/** Cores da escalada: frio, morno, aquecido, quente. */
const COR_FRIO = "#8AB4F8";
const COR_MORNO = "#7A6BC4";
const COR_AQUECIDO = "#E09B0D";
const COR_QUENTE = "#F76A62";

export function BarraDeCalor({
  score,
  faixa,
  limiarMorno,
  limiarAquecido,
  limiarQuente,
  mostrarNumero = true,
  className = "",
}: {
  score: number | null;
  faixa: string | null;
  /** Limiares configurados em /leads/pontuacao. */
  limiarMorno: number;
  limiarAquecido: number;
  limiarQuente: number;
  mostrarNumero?: boolean;
  className?: string;
}) {
  // Nulo = o worker ainda não passou por este lead. Não é frio, é desconhecido
  // — mostrar 0 diria que ele não tem engajamento, o que seria mentira.
  if (score === null) {
    return (
      <span className={`text-sm text-muted-foreground ${className}`}>—</span>
    );
  }

  const escala = Math.max(1, limiarQuente);
  // Negativo existe (descadastro vale −30) e não tem barra: o chão é zero.
  const proporcao = Math.min(1, Math.max(0, score / escala));
  const pct = Math.round(proporcao * 100);

  // Paradas nos limiares reais, presas ao intervalo válido para o degradê não
  // quebrar se alguém configurar cortes fora de ordem na tela.
  const paradaMorno = Math.min(99, Math.max(1, (limiarMorno / escala) * 100));
  const paradaAquecido = Math.min(
    99,
    Math.max(paradaMorno + 1, (limiarAquecido / escala) * 100)
  );
  const degrade =
    `linear-gradient(90deg, ${COR_FRIO} 0%, ${COR_MORNO} ${paradaMorno}%, ` +
    `${COR_AQUECIDO} ${paradaAquecido}%, ${COR_QUENTE} 100%)`;

  const info = faixaInfo(faixa);

  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <span
        className="relative h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Calor do lead: ${score} pontos${info ? `, ${info.rotulo.toLowerCase()}` : ""}`}
      >
        {pct > 0 ? (
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${pct}%`,
              backgroundImage: degrade,
              // O degradê é esticado para que a fatia visível corresponda ao
              // trecho certo da escala — assim a ponta preenchida tem a cor
              // daquele ponto, e não a cor do início do degradê.
              backgroundSize: `${(100 / pct) * 100}% 100%`,
            }}
          />
        ) : null}
      </span>
      {mostrarNumero ? (
        <span className="text-sm font-semibold tabular-nums">{score}</span>
      ) : null}
    </span>
  );
}
