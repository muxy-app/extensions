import { Loader2 } from "lucide-react";

export function LoadingOverlay({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
      <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 size={16} strokeWidth={2} className="animate-spin" />
        {label}
      </span>
    </div>
  );
}
