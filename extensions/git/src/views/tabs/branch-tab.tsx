import { open_diff, confirm_action } from "@/lib/git";
import type { GitStatus } from "@/lib/git-status";
import { CommitBox } from "@/components/commit-box";
import { FileSection } from "@/components/file-section";
import { EmptyState } from "@/components/empty-state";

interface BranchTabProps {
  status: GitStatus;
  stage: (path: string) => Promise<boolean>;
  unstage: (path: string) => Promise<boolean>;
  stage_all: () => Promise<boolean>;
  unstage_all: () => Promise<boolean>;
  discard: (path: string) => Promise<boolean>;
  discard_all: () => Promise<boolean>;
  commit: (message: string) => Promise<boolean>;
  sync: (op: "push" | "pull") => Promise<boolean>;
  message: string;
  on_message: (message: string) => void;
}

export function BranchTab({
  status,
  stage,
  unstage,
  stage_all,
  unstage_all,
  discard,
  discard_all,
  commit,
  sync,
  message,
  on_message,
}: BranchTabProps) {
  const clean = status.staged.length === 0 && status.unstaged.length === 0;

  async function discard_one(path: string) {
    const ok = await confirm_action({
      title: "Discard changes",
      message: `Are you sure you want to discard changes in ${path}? This cannot be undone.`,
      confirmLabel: "Discard",
      critical: true,
    });
    if (ok) void discard(path);
  }

  async function discard_changes() {
    const ok = await confirm_action({
      title: "Discard all changes",
      message: `Are you sure you want to discard all ${status.unstaged.length} changes? This cannot be undone.`,
      confirmLabel: "Discard All",
      critical: true,
    });
    if (ok) void discard_all();
  }

  return (
    <>
      <section className="flex flex-col gap-2 border-b border-border p-2.5">
        <CommitBox
          canCommit={status.staged.length > 0}
          message={message}
          onMessage={on_message}
          onCommit={commit}
          onPull={() => sync("pull")}
          onPush={() => sync("push")}
        />
      </section>

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
          onDiscard={(path) => void discard_one(path)}
          onBulkDiscard={() => void discard_changes()}
          onOpen={open_diff}
        />
        {clean && <EmptyState>No changes.</EmptyState>}
      </main>
    </>
  );
}
