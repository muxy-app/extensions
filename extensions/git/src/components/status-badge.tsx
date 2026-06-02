import { cn } from "@/lib/utils";

const BADGE_COLOR: Record<string, string> = {
  A: "text-diff-add",
  D: "text-diff-remove",
  M: "text-primary",
  R: "text-primary",
  U: "text-diff-add",
  "?": "text-diff-add",
};

const BADGE_TITLE: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  U: "Conflicted",
  "?": "Untracked",
};

export function StatusBadge({ label }: { label: string }) {
  return (
    <span
      title={BADGE_TITLE[label] ?? label}
      className={cn(
        "w-3.5 shrink-0 text-center font-mono text-[11px] font-bold leading-none",
        BADGE_COLOR[label] ?? "text-muted-foreground",
      )}
    >
      {label === "?" ? "U" : label}
    </span>
  );
}
