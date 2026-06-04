import { Check, GitPullRequest } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PrimaryMode } from "@/components/commit-box";

interface ModeToggleProps {
  mode: PrimaryMode;
  onChange: (mode: PrimaryMode) => void;
}

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
      <Segment icon={Check} label="Commit" active={mode === "commit"} onClick={() => onChange("commit")} />
      <Segment
        icon={GitPullRequest}
        label="Create PR"
        active={mode === "pr"}
        onClick={() => onChange("pr")}
      />
    </div>
  );
}

function Segment({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Check;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[11px] font-medium outline-none transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon size={11} strokeWidth={2.5} />
      {label}
    </button>
  );
}
