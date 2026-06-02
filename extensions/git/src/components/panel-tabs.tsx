import { GitPullRequest, GitBranch } from "lucide-react";
import { ICON_SIZE, ICON_STROKE } from "@/lib/icons";
import { cn } from "@/lib/utils";

export type PanelTab = "changes" | "prs";

interface PanelTabsProps {
  active: PanelTab;
  onChange: (tab: PanelTab) => void;
}

export function PanelTabs({ active, onChange }: PanelTabsProps) {
  return (
    <div className="flex shrink-0 items-center">
      <TabButton
        title="Changes"
        active={active === "changes"}
        onClick={() => onChange("changes")}
        icon={GitBranch}
      />
      <TabButton
        title="Pull Requests"
        active={active === "prs"}
        onClick={() => onChange("prs")}
        icon={GitPullRequest}
      />
    </div>
  );
}

interface TabButtonProps {
  title: string;
  active: boolean;
  onClick: () => void;
  icon: typeof GitBranch;
}

function TabButton({ title, active, onClick, icon: Icon }: TabButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "flex size-6 items-center justify-center rounded outline-none transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon size={ICON_SIZE.bar} strokeWidth={ICON_STROKE} />
    </button>
  );
}
