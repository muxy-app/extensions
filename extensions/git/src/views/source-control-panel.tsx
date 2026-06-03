import { useState } from "react";
import { GitPullRequest, RotateCw, X } from "lucide-react";
import { close_panel, open_diff, open_pr_diff } from "@/lib/git";
import type { GitStatus } from "@/lib/git-status";
import type { BranchList } from "@/lib/git-branches";
import type { MergeMethod } from "@/lib/git-prs";
import type { CreatePrInput, PrsState } from "@/hooks/use-prs";
import { ICON_SIZE, ICON_STROKE } from "@/lib/icons";
import { BranchBar } from "@/components/branch-bar";
import { CommitBox } from "@/components/commit-box";
import { CreatePrForm } from "@/components/create-pr-form";
import { CurrentPrPopover } from "@/components/current-pr-popover";
import { FileSection } from "@/components/file-section";
import { EmptyState } from "@/components/empty-state";
import { LoadingOverlay } from "@/components/loading-overlay";
import { PanelTabs, type PanelTab } from "@/components/panel-tabs";
import { PrList } from "@/components/pr-list";

interface SourceControlPanelProps {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  status: GitStatus;
  switching: boolean;
  refresh: () => Promise<void>;
  stage: (path: string) => Promise<boolean>;
  unstage: (path: string) => Promise<boolean>;
  stage_all: () => Promise<boolean>;
  unstage_all: () => Promise<boolean>;
  commit: (message: string) => Promise<boolean>;
  sync: (op: "push" | "pull", success: string) => Promise<boolean>;
  get_branches: () => Promise<BranchList>;
  checkout: (name: string, create: boolean) => Promise<boolean>;
  delete_branch: (name: string) => Promise<boolean>;
  cleanup: () => Promise<boolean>;
  prs: {
    state: PrsState;
    refreshing: boolean;
    busy: number | null;
    refresh: () => Promise<void>;
    checkout_here: (pr: MuxyGitPRListItem) => void;
    checkout_worktree: (pr: MuxyGitPRListItem) => void;
    merge: (number: number, method: MergeMethod, deleteBranch: boolean) => Promise<boolean>;
    close: (number: number) => Promise<boolean>;
    create: (input: CreatePrInput) => Promise<boolean>;
  };
}

export function SourceControlPanel({
  tab,
  onTabChange,
  status,
  switching,
  refresh,
  stage,
  unstage,
  stage_all,
  unstage_all,
  commit,
  sync,
  get_branches,
  checkout,
  delete_branch,
  cleanup,
  prs,
}: SourceControlPanelProps) {
  const clean = status.staged.length === 0 && status.unstaged.length === 0;
  const [creating, set_creating] = useState(false);
  const currentPr = status.pullRequest;

  const tabs = <PanelTabs active={tab} onChange={onTabChange} />;

  return (
    <div className="relative flex h-screen flex-col">
      {switching && <LoadingOverlay label="Loading worktree…" />}
      {tab === "changes" ? (
        <>
          <BranchBar
            leading={tabs}
            afterBranch={
              currentPr ? (
                <CurrentPrPopover
                  pr={currentPr}
                  busy={prs.busy === currentPr.number}
                  onMerge={(method, deleteBranch) =>
                    prs.merge(currentPr.number, method, deleteBranch)
                  }
                  onClose={prs.close}
                  onCleanup={cleanup}
                />
              ) : (
                <button
                  type="button"
                  title="Create pull request"
                  onClick={() => set_creating((v) => !v)}
                  className="flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-[11px] font-medium text-foreground outline-none transition-colors hover:border-primary hover:bg-accent"
                >
                  <GitPullRequest size={12} strokeWidth={2} />
                  Create PR
                </button>
              )
            }
            branch={status.branch ?? "—"}
            ahead={status.ahead}
            behind={status.behind}
            loadBranches={get_branches}
            onCheckout={checkout}
            onDeleteBranch={delete_branch}
            onRefresh={refresh}
            onClose={close_panel}
          />

          {creating && !currentPr ? (
            <CreatePrForm
              baseBranch={status.defaultBranch}
              onSubmit={prs.create}
              onBack={() => set_creating(false)}
            />
          ) : (
            <CommitBox
              canCommit={status.staged.length > 0}
              onCommit={commit}
              onPull={() => sync("pull", "Pulled")}
              onPush={() => sync("push", "Pushed")}
            />
          )}

          <main className="flex min-h-0 flex-1 flex-col overflow-auto">
            <FileSection
              id="staged"
              title="Staged Changes"
              entries={status.staged}
              staged
              bulkLabel="Unstage all"
              onBulk={() => void unstage_all()}
              onAction={(path) => void unstage(path)}
              onOpen={open_diff}
            />
            <FileSection
              id="changes"
              title="Changes"
              entries={status.unstaged}
              staged={false}
              bulkLabel="Stage all"
              onBulk={() => void stage_all()}
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
            <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
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
              onCheckoutHere={prs.checkout_here}
              onCheckoutWorktree={prs.checkout_worktree}
              onViewDiff={(pr) => void open_pr_diff(pr.number)}
            />
          </main>
        </>
      )}
    </div>
  );
}
