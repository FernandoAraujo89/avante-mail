"use client";

import { useMemo, useRef, useState } from "react";

import type { SeriesPoint } from "@/lib/reports";

const OPEN_COLOR = "#3ECF8E";
const CLICK_COLOR = "#ec4899";

const WIDTH = 900;
const HEIGHT = 300;
const PAD = { top: 16, right: 20, bottom: 34, left: 40 };

const dayLabelFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "America/Sao_Paulo",
});

function labelForDay(date: string): string {
  // date = YYYY-MM-DD → rotula ao meio-dia p/ evitar viés de fuso.
  return dayLabelFmt.format(new Date(`${date}T12:00:00-03:00`));
}

export function EngagementChart({ series }: { series: SeriesPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const maxY = useMemo(() => {
    const m = Math.max(1, ...series.flatMap((p) => [p.opened, p.clicked]));
    // Arredonda para cima para um "teto" agradável.
    const step = m <= 5 ? 1 : m <= 20 ? 5 : m <= 100 ? 10 : 50;
    return Math.ceil(m / step) * step;
  }, [series]);

  const n = series.length;
  const xFor = (i: number) =>
    PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (v: number) => PAD.top + plotH - (v / maxY) * plotH;

  const buildPath = (key: "opened" | "clicked") => {
    if (n === 0) return { line: "", area: "" };
    const pts = series.map((p, i) => `${xFor(i)},${yFor(p[key])}`);
    const line = `M${pts.join("L")}`;
    const area = `M${xFor(0)},${PAD.top + plotH}L${pts.join("L")}L${xFor(
      n - 1
    )},${PAD.top + plotH}Z`;
    return { line, area };
  };

  const openPath = buildPath("opened");
  const clickPath = buildPath("clicked");

  const yTicks = useMemo(() => {
    // Nunca mais divisões que o próprio máximo, para não repetir inteiros.
    const count = Math.min(4, maxY);
    const ticks = Array.from({ length: count + 1 }, (_, i) =>
      Math.round((maxY / count) * i)
    );
    return [...new Set(ticks)];
  }, [maxY]);

  // Rotula no máximo ~8 datas no eixo X para não poluir.
  const xTickEvery = Math.max(1, Math.ceil(n / 8));

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const ratio = (x - PAD.left) / plotW;
    const idx = Math.round(ratio * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, idx)));
  }

  if (n === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        Sem dados de engajamento no período.
      </div>
    );
  }

  const hoverPoint = hover !== null ? series[hover] : null;

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center gap-5 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: OPEN_COLOR }}
          />
          Aberturas
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: CLICK_COLOR }}
          />
          Cliques
        </span>
      </div>

      <div className="relative w-full">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          style={{ height: "auto" }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label="Gráfico de engajamento: aberturas e cliques por dia"
        >
          <defs>
            <linearGradient id="openFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={OPEN_COLOR} stopOpacity="0.28" />
              <stop offset="100%" stopColor={OPEN_COLOR} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="clickFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CLICK_COLOR} stopOpacity="0.24" />
              <stop offset="100%" stopColor={CLICK_COLOR} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grade + eixo Y */}
          {yTicks.map((tick, ti) => {
            const y = yFor(tick);
            return (
              <g key={`y-${ti}`}>
                <line
                  x1={PAD.left}
                  y1={y}
                  x2={WIDTH - PAD.right}
                  y2={y}
                  stroke="#DCE6F1"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="#6B8091"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* Rótulos do eixo X */}
          {series.map((p, i) =>
            i % xTickEvery === 0 || i === n - 1 ? (
              <text
                key={p.date}
                x={xFor(i)}
                y={HEIGHT - 12}
                textAnchor="middle"
                fontSize={11}
                fill="#6B8091"
              >
                {labelForDay(p.date)}
              </text>
            ) : null
          )}

          {/* Áreas */}
          <path d={openPath.area} fill="url(#openFill)" />
          <path d={clickPath.area} fill="url(#clickFill)" />

          {/* Linhas */}
          <path
            d={openPath.line}
            fill="none"
            stroke={OPEN_COLOR}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path
            d={clickPath.line}
            fill="none"
            stroke={CLICK_COLOR}
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {/* Marcadores */}
          {series.map((p, i) => (
            <g key={`m-${p.date}`}>
              <circle cx={xFor(i)} cy={yFor(p.opened)} r={2.5} fill={OPEN_COLOR} />
              <circle
                cx={xFor(i)}
                cy={yFor(p.clicked)}
                r={2.5}
                fill={CLICK_COLOR}
              />
            </g>
          ))}

          {/* Linha-guia + destaque no ponto sob o cursor */}
          {hover !== null && hoverPoint ? (
            <g>
              <line
                x1={xFor(hover)}
                y1={PAD.top}
                x2={xFor(hover)}
                y2={PAD.top + plotH}
                stroke="#95A7B5"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              <circle
                cx={xFor(hover)}
                cy={yFor(hoverPoint.opened)}
                r={4}
                fill={OPEN_COLOR}
                stroke="#ffffff"
                strokeWidth={1.5}
              />
              <circle
                cx={xFor(hover)}
                cy={yFor(hoverPoint.clicked)}
                r={4}
                fill={CLICK_COLOR}
                stroke="#ffffff"
                strokeWidth={1.5}
              />
            </g>
          ) : null}
        </svg>

        {/* Tooltip — vira para baixo perto do topo e ancora nas bordas. */}
        {hover !== null && hoverPoint ? (
          (() => {
            const topPct =
              (yFor(Math.max(hoverPoint.opened, hoverPoint.clicked)) / HEIGHT) *
              100;
            const leftPct = (xFor(hover) / WIDTH) * 100;
            const below = topPct < 26; // ponto perto do topo → tooltip abaixo
            const anchorLeft = leftPct < 12;
            const anchorRight = leftPct > 88;
            return (
              <div
                className="pointer-events-none absolute z-10 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg"
                style={{
                  left: `${Math.min(96, Math.max(4, leftPct))}%`,
                  top: `${topPct}%`,
                  transform: `translate(${
                    anchorLeft ? "0" : anchorRight ? "-100%" : "-50%"
                  }, ${below ? "12px" : "calc(-100% - 12px)"})`,
                }}
              >
            <p className="mb-1 font-medium">{labelForDay(hoverPoint.date)}</p>
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: OPEN_COLOR }}
              />
              Aberturas: <span className="text-foreground">{hoverPoint.opened}</span>
            </p>
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: CLICK_COLOR }}
              />
              Cliques: <span className="text-foreground">{hoverPoint.clicked}</span>
            </p>
              </div>
            );
          })()
        ) : null}
      </div>
    </div>
  );
}
