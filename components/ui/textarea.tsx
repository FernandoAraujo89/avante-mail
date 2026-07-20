import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-[60px] w-full rounded-lg border-[1.5px] border-input bg-card px-3 py-2 text-sm font-medium transition-colors placeholder:font-light placeholder:text-input focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-65",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
