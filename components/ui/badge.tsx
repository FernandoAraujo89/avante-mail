import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Badge do Design System Avante: raio 3px, 12px, peso 500 (teto do sistema).
// Variantes de status do Figma (Status/Tabelas), com os pares de cor
// ajustados para contraste AA — ver os tokens -soft/-dark em globals.css.
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-semibold leading-none whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        // Neutro "apagado" (arquivada, contagem): contorno em vez de fundo,
        // para não se confundir com o secundário.
        outline: "border border-input bg-transparent text-muted-foreground",
        // Status: texto escuro sobre fundo suave — todos ≥ 4,5:1.
        success: "bg-success-soft text-success-dark",
        warning: "bg-warning-soft text-warning-dark",
        info: "bg-info-light text-info-dark",
        destructive: "bg-destructive-soft text-destructive-hover",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
