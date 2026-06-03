import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      autoComplete="off"
      className={cn(
        "flex w-full rounded-md border border-input bg-muted px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-ring resize-y",
        className,
      )}
      {...props}
    />
  );
}
