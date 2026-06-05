import { GitBranch, GitPullRequest, History } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabId = "branch" | "prs" | "history";

const TABS: { id: TabId; label: string; icon: typeof GitBranch }[] = [
  { id: "branch", label: "Branch", icon: GitBranch },
  { id: "prs", label: "PRs", icon: GitPullRequest },
  { id: "history", label: "History", icon: History },
];

interface PanelTabsProps {
  value: TabId;
  onChange: (tab: TabId) => void;
  changes: number;
}

export function PanelTabs({ value, onChange, changes }: PanelTabsProps) {
  return (
    <div className="flex shrink-0 border-b border-border">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-[11px] font-medium outline-none transition-colors",
            value === id
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon size={12} strokeWidth={2.5} />
          {label}
          {id === "branch" && changes > 0 && (
            <span className="rounded-full bg-muted-foreground px-1.5 py-px text-[9px] font-bold leading-none text-background">
              {changes}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
