"use client";

import { ETAPAS, etapaDoConvite, type ConviteComEtapa } from "@/lib/pesquisas/mapeamento";
import { cn } from "@/lib/utils";

/**
 * As cinco etapas do parceiro numa fase (Enviado → Abriu → Iniciou →
 * Concluiu → Validado), como cinco traços e o nome da etapa atual.
 * Encerrado sem resposta sai da régua e aparece só como texto.
 */
export function EtapasDoParceiro({ convite, className }: { convite: ConviteComEtapa; className?: string }) {
  const e = etapaDoConvite(convite);
  if (e.indice < 0) {
    return <span className={cn("text-xs text-muted-foreground", className)}>{e.rotulo}</span>;
  }
  const concluiu = e.indice >= 3;
  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      role="img"
      aria-label={`Etapa ${e.indice + 1} de ${ETAPAS.length}: ${e.rotulo}`}
      title={`Etapa ${e.indice + 1} de ${ETAPAS.length} · ${e.rotulo}`}
    >
      <span className="flex gap-0.5" aria-hidden>
        {ETAPAS.map((etapa, i) => (
          <span
            key={etapa}
            className={cn(
              "h-1.5 w-3 rounded-full",
              i > e.indice ? "bg-border" : e.indice === 4 ? "bg-success-dark" : concluiu ? "bg-success" : "bg-primary"
            )}
          />
        ))}
      </span>
      <span className={cn("text-xs", e.indice === 4 ? "text-success-dark" : "text-foreground")}>{e.rotulo}</span>
    </span>
  );
}
