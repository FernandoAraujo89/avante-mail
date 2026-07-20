import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DeltaKind = "count" | "pp"; // count = variação relativa; pp = pontos percentuais

function computeDelta(
  current: number | null,
  previous: number | null,
  kind: DeltaKind
) {
  if (current === null || previous === null) {
    return { text: "—", dir: "flat" as const };
  }
  if (kind === "pp") {
    const diff = current - previous;
    const dir = diff > 0.05 ? "up" : diff < -0.05 ? "down" : "flat";
    return {
      text: `${diff >= 0 ? "+" : "−"}${Math.abs(diff)
        .toFixed(1)
        .replace(".", ",")} pp`,
      dir,
    };
  }
  if (previous === 0) {
    return {
      text: current === 0 ? "0%" : "novo",
      dir: current > 0 ? ("up" as const) : ("flat" as const),
    };
  }
  const pct = ((current - previous) / previous) * 100;
  const dir = pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat";
  return {
    text: `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%`,
    dir,
  };
}

export function KpiTile({
  label,
  value,
  sub,
  current,
  previous,
  kind = "count",
  invert = false,
  showComparison,
}: {
  label: string;
  value: string;
  sub?: string;
  current: number | null;
  previous: number | null;
  kind?: DeltaKind;
  invert?: boolean; // true p/ métricas onde subir é ruim (bounces, descadastros)
  showComparison: boolean;
}) {
  const delta = computeDelta(current, previous, kind);

  // "Bom" = verde. Para métricas invertidas, cair é bom.
  const isGood =
    delta.dir === "flat"
      ? null
      : invert
        ? delta.dir === "down"
        : delta.dir === "up";

  const Icon =
    delta.dir === "up" ? ArrowUp : delta.dir === "down" ? ArrowDown : ArrowRight;

  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="mt-2 flex items-end justify-between gap-2">
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {sub ? (
            <p className="pb-0.5 text-sm text-muted-foreground">{sub}</p>
          ) : null}
        </div>
        {showComparison ? (
          <div
            className={cn(
              "mt-2.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
              isGood === null && "bg-secondary text-muted-foreground",
              isGood === true && "bg-success-light/40 text-success-dark",
              isGood === false && "bg-destructive/15 text-destructive"
            )}
          >
            <Icon className="size-3" />
            {delta.text}
            <span className="text-muted-foreground/70">vs. anterior</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
