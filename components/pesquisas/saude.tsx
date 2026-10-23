"use client";

import { Badge } from "@/components/ui/badge";
import type { PartnerTier } from "@/lib/db/schema";
import { SAUDE_LABEL, TIER_LABEL, type Saude } from "@/lib/pesquisas/mapeamento";

const SAUDE_VARIANT: Record<Saude, "success" | "warning" | "destructive" | "outline"> = {
  saudavel: "success",
  atencao: "warning",
  em_risco: "destructive",
  sem_medicao: "outline",
};

/** Mapa de saúde do projeto: Saudável · Atenção · Em risco (ou sem medição). */
export function SaudeBadge({ saude }: { saude: Saude }) {
  return <Badge variant={SAUDE_VARIANT[saude]}>{SAUDE_LABEL[saude]}</Badge>;
}

/** Classificação do parceiro (Diamante, Ouro, Prata, Bronze). */
export function TierBadge({ tier }: { tier: PartnerTier | null | undefined }) {
  if (!tier) return <span className="text-xs text-muted-foreground">sem classificação</span>;
  return <Badge variant="secondary">{TIER_LABEL[tier]}</Badge>;
}
