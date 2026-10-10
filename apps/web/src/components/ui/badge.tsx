import * as React from "react";
import { cn } from "@/lib/utils";

export const Badge = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink",
      className
    )}
    {...props}
  />
);
