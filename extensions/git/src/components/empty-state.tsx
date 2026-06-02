import type { ReactNode } from "react";

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-7 text-center text-muted-foreground">
      {children}
    </div>
  );
}
