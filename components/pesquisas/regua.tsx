"use client";

import { diaDoConvite, proximoPasso, type ConviteNaRegua, type PassoDaRegua } from "@/lib/pesquisas/mapeamento";
import { cn } from "@/lib/utils";

export const PASSO_DA_REGUA_LABEL: Record<PassoDaRegua["chave"], string> = {
  convite: "Convite",
  lembrete: "Lembrete",
  mensagem: "Mensagem pessoal",
  ligacao: "Ligação",
  reuniao: "Reunião",
};

/**
 * Onde o convite está na régua de follow-up: D+N e o próximo passo, com
 * "hoje", "em N dias" ou o atraso. Concluído ou encerrado não mostra nada.
 */
export function ProximoPassoDaRegua({ convite, className }: { convite: ConviteNaRegua; className?: string }) {
  if (convite.status === "completed" || convite.status === "closed") return null;
  const dia = diaDoConvite(convite.createdAt);
  const p = proximoPasso(convite);
  if (!p) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        D+{dia} · régua concluída — registrar &quot;sem resposta&quot; ou resposta assistida
      </span>
    );
  }
  const atrasado = p.faltam < 0;
  const quando = atrasado
    ? `${-p.faltam} ${-p.faltam === 1 ? "dia" : "dias"} de atraso`
    : p.faltam === 0
      ? "hoje"
      : `em ${p.faltam} ${p.faltam === 1 ? "dia" : "dias"}`;
  return (
    <span
      className={cn(
        "text-xs",
        atrasado ? "text-destructive" : p.faltam === 0 ? "text-warning-dark" : "text-muted-foreground",
        className
      )}
      title={`${p.passo.acao} · ${p.passo.canal} · ${p.passo.responsavel}`}
    >
      D+{dia} · {PASSO_DA_REGUA_LABEL[p.passo.chave]} D+{p.passo.dia} ({p.passo.responsavel}) · {quando}
    </span>
  );
}
