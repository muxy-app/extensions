import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      autoComplete="off"
      className={cn(
        "flex h-8 w-full rounded-md border border-input bg-muted px-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-ring",
        className,
      )}
      {...props}
    />
  );
}
