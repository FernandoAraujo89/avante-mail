// Gráficos do relatório da pesquisa — SVG e barras simples, sem biblioteca,
// no padrão de components/reports/engagement-chart.tsx.
import type { Funil as FunilDados, ItemDeBarra, Nps } from "@/lib/pesquisas/relatorio";
import { cn } from "@/lib/utils";

const AZUL = "#1D50DC";
const VERDE = "#3ECF8E";
const AMBAR = "#F59E0B";
const VERMELHO = "#EF4444";
const CINZA = "#E2E8F0";

function pct(parte: number, todo: number): number {
  return todo === 0 ? 0 : Math.round((parte / todo) * 100);
}

/** Barras horizontais com rótulo, contagem e %. */
export function BarrasHorizontais({
  itens,
  cor = AZUL,
}: {
  itens: ItemDeBarra[];
  cor?: string;
}) {
  const maior = Math.max(1, ...itens.map((i) => i.count));
  return (
    <ul className="flex flex-col gap-2">
      {itens.map((item) => (
        <li key={item.rotulo} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
          <span className="truncate" title={item.rotulo}>
            {item.rotulo}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {item.count} · {item.pct}%
          </span>
          <div className="col-span-2 h-2 overflow-hidden rounded-full" style={{ background: CINZA }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${(item.count / maior) * 100}%`, background: cor }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** O funil do convite: cada degrau em % de convidados. */
export function Funil({ funil }: { funil: FunilDados }) {
  const degraus: { rotulo: string; valor: number }[] = [
    { rotulo: "Convidados", valor: funil.convidados },
    { rotulo: "Abriram o link", valor: funil.abriram },
    { rotulo: "Começaram", valor: funil.comecaram },
    { rotulo: "Concluíram", valor: funil.concluiram },
  ];
  return (
    <BarrasHorizontais
      itens={degraus.map((d) => ({ rotulo: d.rotulo, count: d.valor, pct: pct(d.valor, funil.convidados) }))}
      cor={VERDE}
    />
  );
}

/** Colunas por valor da escala; na pergunta do NPS, cada faixa tem sua cor. */
export function Distribuicao({ itens, nps }: { itens: ItemDeBarra[]; nps?: boolean }) {
  const W = 600;
  const H = 180;
  const PAD = { top: 18, bottom: 26, left: 8, right: 8 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const maior = Math.max(1, ...itens.map((i) => i.count));
  const passo = plotW / Math.max(1, itens.length);
  const largura = Math.min(44, passo * 0.7);

  const corDe = (rotulo: string) => {
    if (!nps) return AZUL;
    const v = Number(rotulo);
    return v >= 9 ? VERDE : v >= 7 ? AMBAR : VERMELHO;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Distribuição das respostas">
      {itens.map((item, i) => {
        const altura = (item.count / maior) * plotH;
        const x = PAD.left + i * passo + (passo - largura) / 2;
        const y = PAD.top + plotH - altura;
        return (
          <g key={item.rotulo}>
            <rect x={x} y={y} width={largura} height={altura} rx={4} fill={corDe(item.rotulo)} opacity={item.count === 0 ? 0.25 : 1} />
            {item.count > 0 ? (
              <text x={x + largura / 2} y={y - 5} textAnchor="middle" fontSize={11} fill="#64748B">
                {item.count}
              </text>
            ) : null}
            <text x={x + largura / 2} y={H - 8} textAnchor="middle" fontSize={12} fill="#334155">
              {item.rotulo}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** O arco do NPS: detratores, neutros e promotores, com o score no meio. */
export function ArcoNps({ nps, className }: { nps: Nps; className?: string }) {
  const W = 240;
  const H = 140;
  const cx = W / 2;
  const cy = H - 14;
  const r = 100;
  const espessura = 22;

  const ponto = (ang: number) => ({
    x: cx + r * Math.cos(Math.PI - ang),
    y: cy - r * Math.sin(Math.PI - ang),
  });
  const arco = (de: number, ate: number): string => {
    const a = ponto(de);
    const b = ponto(ate);
    const grande = ate - de > Math.PI ? 1 : 0;
    return `M${a.x},${a.y} A${r},${r} 0 ${grande} 1 ${b.x},${b.y}`;
  };

  const faixas = [
    { valor: nps.detratores, cor: VERMELHO, rotulo: "Detratores" },
    { valor: nps.neutros, cor: AMBAR, rotulo: "Neutros" },
    { valor: nps.promotores, cor: VERDE, rotulo: "Promotores" },
  ];
  let acumulado = 0;

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-60" role="img" aria-label={`NPS ${nps.score}`}>
        <path d={arco(0.001, Math.PI - 0.001)} stroke={CINZA} strokeWidth={espessura} fill="none" strokeLinecap="round" />
        {faixas.map((f) => {
          if (f.valor === 0) return null;
          const de = (acumulado / nps.n) * Math.PI;
          acumulado += f.valor;
          const ate = (acumulado / nps.n) * Math.PI;
          return <path key={f.rotulo} d={arco(Math.max(de, 0.001), Math.min(ate, Math.PI - 0.001))} stroke={f.cor} strokeWidth={espessura} fill="none" />;
        })}
        <text x={cx} y={cy - 18} textAnchor="middle" fontSize={34} fontWeight={700} fill="#0F172A">
          {nps.score}
        </text>
        <text x={cx} y={cy + 2} textAnchor="middle" fontSize={11} fill="#64748B">
          NPS · {nps.n} resposta{nps.n === 1 ? "" : "s"}
        </text>
      </svg>
      <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
        {faixas.map((f) => (
          <li key={f.rotulo} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: f.cor }} />
            {f.rotulo}: {f.valor} ({pct(f.valor, nps.n)}%)
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SimNao({ sim, nao }: { sim: number; nao: number }) {
  const n = sim + nao;
  return (
    <BarrasHorizontais
      itens={[
        { rotulo: "Sim", count: sim, pct: pct(sim, n) },
        { rotulo: "Não", count: nao, pct: pct(nao, n) },
      ]}
    />
  );
}
