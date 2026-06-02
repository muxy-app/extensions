import { useState, type ReactNode } from "react";
import { RotateCw, X } from "lucide-react";
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
  onRefresh: () => Promise<unknown>;
  onClose: () => void;
  leading?: ReactNode;
}

export function BranchBar({
  branch,
  ahead,
  behind,
  loadBranches,
  onCheckout,
  onDeleteBranch,
  onRefresh,
  onClose,
  leading,
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
    <header className="panel-topbar flex items-center gap-2 px-2">
      {leading}
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
        <button
          type="button"
          title="Close panel"
          onClick={onClose}
          className="flex items-center justify-center p-1 text-muted-foreground outline-none transition-colors hover:text-foreground"
        >
          <X size={ICON_SIZE.bar} strokeWidth={ICON_STROKE} />
        </button>
      </div>
    </header>
  );
}
