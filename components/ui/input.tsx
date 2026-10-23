import * as React from "react";

import { cn } from "@/lib/utils";

// Input do Design System Avante: 36px, borda 1.5px (token --color-input, 3:1), raio 5px.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full rounded-lg border-[1.5px] border-input bg-card px-3 py-1 text-sm font-medium transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:font-light placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-65",
        className
      )}
      {...props}
    />
  );
}

export { Input };
