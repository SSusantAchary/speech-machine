import * as React from "react";
import { cn } from "@/lib/utils";

export const Toggle = ({ pressed, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }) => (
  <button
    className={cn(
      "rounded-full border px-4 py-2 text-xs font-semibold transition",
      pressed ? "border-ember/50 bg-ember/20" : "border-ink/10 bg-white/60",
      className
    )}
    {...props}
  />
);
