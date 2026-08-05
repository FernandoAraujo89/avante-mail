import { faixaInfo } from "@/components/leads/estagios";

/**
 * A barra de calor do lead — "o quão aquecido ele está", de relance.
 *
 * DUAS DECISÕES QUE GOVERNAM A LEITURA:
 *
 * 1. A escala vai até o DOBRO do limiar de quente, não até ele. Se a barra
 *    enchesse em "quente", todo lead acima do limiar ficaria idêntico — e é
 *    exatamente ali que a distinção importa, porque é dela que sai a escolha de
 *    quem mandar ao comercial. Com o dobro, quem está em 52 e quem está em 130
 *    param em lugares visivelmente diferentes.
 *
 * 2. A cor vem da POSIÇÃO, não da faixa. O degradê é contínuo e a parte
 *    preenchida termina na cor daquele ponto: um lead frio acaba em azul, um
 *    fervendo acaba em vermelho. Se a cor fosse por faixa, a barra teria três
 *    saltos e perderia a granularidade que o número tem.
 */

/** Paradas do degradê: frio → morno → quente → fervendo. */
const DEGRADE =
  "linear-gradient(90deg, #8AB4F8 0%, #7A6BC4 34%, #E09B0D 67%, #F76A62 100%)";

export function BarraDeCalor({
  score,
  faixa,
  limiarQuente,
  mostrarNumero = true,
  className = "",
}: {
  score: number | null;
  faixa: string | null;
  /** Limiar de "quente" configurado em /leads/pontuacao. */
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

  const escala = Math.max(1, limiarQuente * 2);
  // Negativo existe (descadastro vale −30) e não tem barra: o chão é zero.
  const proporcao = Math.min(1, Math.max(0, score / escala));
  const pct = Math.round(proporcao * 100);

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
              backgroundImage: DEGRADE,
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
