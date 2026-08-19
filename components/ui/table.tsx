import * as React from "react";

import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:border-border", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "group/row border-b border-border transition-colors hover:bg-muted/70 data-[state=selected]:bg-accent",
        className
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-3 py-3 align-middle", className)}
      {...props}
    />
  );
}

/**
 * Cabeçalho e célula da coluna de ações, fixos à direita: quando a tabela
 * rola na horizontal, as ações continuam sempre visíveis por cima do
 * conteúdo. O fundo é opaco e acompanha o hover/seleção da linha.
 */
function TableActionsHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <TableHead
      className={cn(
        "sticky right-0 z-10 bg-card text-right shadow-[-8px_0_8px_-8px_rgba(40,46,63,0.12)]",
        className
      )}
      {...props}
    />
  );
}

function TableActionsCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <TableCell
      className={cn(
        "sticky right-0 z-10 bg-card shadow-[-8px_0_8px_-8px_rgba(40,46,63,0.12)] transition-colors",
        "group-hover/row:bg-[color-mix(in_srgb,var(--color-muted)_70%,var(--color-card))]",
        "group-data-[state=selected]/row:bg-accent",
        className
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableActionsHead,
  TableActionsCell,
  TableCaption,
};
