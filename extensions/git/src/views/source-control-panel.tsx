import { open_diff, toast, type GitResult } from "@/lib/git";
import type { GitStatus } from "@/lib/git-status";
import type { BranchList } from "@/lib/git-branches";
import { BranchBar } from "@/components/branch-bar";
import { CommitBox } from "@/components/commit-box";
import { FileSection } from "@/components/file-section";
import { EmptyState } from "@/components/empty-state";

interface SourceControlPanelProps {
  status: GitStatus;
  refresh: () => Promise<void>;
  run_action: (args: string[]) => Promise<GitResult>;
  stage: (path: string) => Promise<GitResult>;
  unstage: (path: string) => Promise<GitResult>;
  sync: (args: string[], success: string) => Promise<GitResult>;
  get_branches: () => Promise<BranchList>;
  checkout: (name: string, create: boolean) => Promise<GitResult>;
  delete_branch: (name: string) => Promise<GitResult>;
}

export function SourceControlPanel({
  status,
  refresh,
  run_action,
  stage,
  unstage,
  sync,
  get_branches,
  checkout,
  delete_branch,
}: SourceControlPanelProps) {
  const clean = status.staged.length === 0 && status.unstaged.length === 0;

  async function commit(message: string) {
    const res = await run_action(["commit", "-m", message]);
    if (res.ok) toast("Commit created");
    return res.ok;
  }

  return (
    <div className="flex h-screen flex-col">
      <BranchBar
        branch={status.branch ?? "—"}
        ahead={status.ahead}
        behind={status.behind}
        loadBranches={get_branches}
        onCheckout={checkout}
        onDeleteBranch={delete_branch}
        onToggleSidebar={() => {}}
        onRefresh={refresh}
      />

      <CommitBox
        canCommit={status.staged.length > 0}
        onCommit={commit}
        onPull={() => sync(["pull"], "Pulled")}
        onPush={() => sync(["push"], "Pushed")}
      />

      <main className="flex-1 overflow-auto">
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
    </div>
  );
}
