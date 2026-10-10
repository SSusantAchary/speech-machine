import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-2xl border border-ink/10 bg-white/80 px-4 text-sm outline-none focus:border-ember/60",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
