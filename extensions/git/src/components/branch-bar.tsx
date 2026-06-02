import { useState } from "react";
import { PanelRight, RotateCw } from "lucide-react";
import type { GitResult } from "@/lib/git";
import type { BranchList } from "@/lib/git-branches";
import { ICON_SIZE, ICON_STROKE } from "@/lib/icons";
import { BranchPicker } from "./branch-picker";

interface BranchBarProps {
  branch: string;
  ahead: number;
  behind: number;
  loadBranches: () => Promise<BranchList>;
  onCheckout: (name: string, create: boolean) => Promise<GitResult>;
  onDeleteBranch: (name: string) => Promise<GitResult>;
  onToggleSidebar: () => void;
  onRefresh: () => Promise<unknown>;
}

export function BranchBar({
  branch,
  ahead,
  behind,
  loadBranches,
  onCheckout,
  onDeleteBranch,
  onToggleSidebar,
  onRefresh,
}: BranchBarProps) {
  const [refreshing, set_refreshing] = useState(false);
  const tracking = [ahead && `↑${ahead}`, behind && `↓${behind}`].filter(Boolean).join(" ");

  async function refresh() {
    if (refreshing) return;
    set_refreshing(true);
    try {
      await onRefresh();
    } finally {
      set_refreshing(false);
    }
  }

  return (
    <header className="flex h-[33px] flex-shrink-0 items-center gap-2 border-b border-border px-2">
      <BranchPicker
        current={branch}
        tracking={tracking}
        loadBranches={loadBranches}
        onCheckout={onCheckout}
        onDeleteBranch={onDeleteBranch}
      />
      <div className="ml-auto flex flex-shrink-0">
        <button
          type="button"
          title="Toggle sidebar"
          onClick={onToggleSidebar}
          className="flex items-center justify-center p-1 text-muted-foreground outline-none transition-colors hover:text-foreground"
        >
          <PanelRight size={ICON_SIZE.bar} strokeWidth={ICON_STROKE} />
        </button>
        <button
          type="button"
          title="Refresh"
          disabled={refreshing}
          onClick={() => void refresh()}
          className="flex items-center justify-center p-1 text-muted-foreground outline-none transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <RotateCw
            className={refreshing ? "animate-spin" : undefined}
            size={ICON_SIZE.bar}
            strokeWidth={ICON_STROKE}
          />
        </button>
      </div>
    </header>
  );
}
