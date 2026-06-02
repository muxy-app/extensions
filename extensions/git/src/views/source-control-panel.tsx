import { RotateCw, X } from "lucide-react";
import { close_panel, open_diff, open_pr_diff, toast, type GitResult } from "@/lib/git";
import type { GitStatus } from "@/lib/git-status";
import type { BranchList } from "@/lib/git-branches";
import type { PrInfo, PrListItem } from "@/lib/gh";
import type { PrsState } from "@/hooks/use-prs";
import { ICON_SIZE, ICON_STROKE } from "@/lib/icons";
import { BranchBar } from "@/components/branch-bar";
import { CommitBox } from "@/components/commit-box";
import { FileSection } from "@/components/file-section";
import { EmptyState } from "@/components/empty-state";
import { PanelTabs, type PanelTab } from "@/components/panel-tabs";
import { PrList } from "@/components/pr-list";

interface SourceControlPanelProps {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  status: GitStatus;
  refresh: () => Promise<void>;
  run_action: (args: string[]) => Promise<GitResult>;
  stage: (path: string) => Promise<GitResult>;
  unstage: (path: string) => Promise<GitResult>;
  sync: (args: string[], success: string) => Promise<GitResult>;
  get_branches: () => Promise<BranchList>;
  checkout: (name: string, create: boolean) => Promise<GitResult>;
  delete_branch: (name: string) => Promise<GitResult>;
  prs: {
    state: PrsState;
    refreshing: boolean;
    busy: number | null;
    refresh: () => Promise<void>;
    detail: (number: number) => Promise<PrInfo | null>;
    checkout_here: (pr: PrListItem) => void;
    checkout_worktree: (pr: PrListItem) => void;
  };
}

export function SourceControlPanel({
  tab,
  onTabChange,
  status,
  refresh,
  run_action,
  stage,
  unstage,
  sync,
  get_branches,
  checkout,
  delete_branch,
  prs,
}: SourceControlPanelProps) {
  const clean = status.staged.length === 0 && status.unstaged.length === 0;

  async function commit(message: string) {
    const res = await run_action(["commit", "-m", message]);
    if (res.ok) toast("Commit created");
    return res.ok;
  }

  const tabs = <PanelTabs active={tab} onChange={onTabChange} />;

  return (
    <div className="flex h-screen flex-col">
      {tab === "changes" ? (
        <>
          <BranchBar
            leading={tabs}
            branch={status.branch ?? "—"}
            ahead={status.ahead}
            behind={status.behind}
            loadBranches={get_branches}
            onCheckout={checkout}
            onDeleteBranch={delete_branch}
            onRefresh={refresh}
            onClose={close_panel}
          />

          <CommitBox
            canCommit={status.staged.length > 0}
            onCommit={commit}
            onPull={() => sync(["pull"], "Pulled")}
            onPush={() => sync(["push"], "Pushed")}
          />

          <main className="flex min-h-0 flex-1 flex-col overflow-auto">
            <FileSection
              id="staged"
              title="Staged Changes"
              entries={status.staged}
              staged
              bulkLabel="Unstage all"
              onBulk={() => void run_action(["reset", "-q"])}
              onAction={(path) => void unstage(path)}
              onOpen={open_diff}
            />
            <FileSection
              id="changes"
              title="Changes"
              entries={status.unstaged}
              staged={false}
              bulkLabel="Stage all"
              onBulk={() => void run_action(["add", "-A"])}
              onAction={(path) => void stage(path)}
              onOpen={open_diff}
            />
            {clean && <EmptyState>No changes.</EmptyState>}
          </main>
        </>
      ) : (
        <>
          <header className="panel-topbar flex items-center gap-2 px-2">
            {tabs}
            <div className="ml-auto flex flex-shrink-0">
              <button
                type="button"
                title="Refresh pull requests"
                disabled={prs.refreshing}
                onClick={() => void prs.refresh()}
                className="flex items-center justify-center p-1 text-muted-foreground outline-none transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <RotateCw
                  className={prs.refreshing ? "animate-spin" : undefined}
                  size={ICON_SIZE.bar}
                  strokeWidth={ICON_STROKE}
                />
              </button>
              <button
                type="button"
                title="Close panel"
                onClick={close_panel}
                className="flex items-center justify-center p-1 text-muted-foreground outline-none transition-colors hover:text-foreground"
              >
                <X size={ICON_SIZE.bar} strokeWidth={ICON_STROKE} />
              </button>
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <PrList
              state={prs.state}
              busy={prs.busy}
              loadDetail={prs.detail}
              onCheckoutHere={prs.checkout_here}
              onCheckoutWorktree={prs.checkout_worktree}
              onViewDiff={(pr) => void open_pr_diff(pr.number, pr.title)}
            />
          </main>
        </>
      )}
    </div>
  );
}
