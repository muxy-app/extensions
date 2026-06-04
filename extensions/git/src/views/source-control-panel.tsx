import { open_diff } from "@/lib/git";
import type { GitStatus } from "@/lib/git-status";
import type { CreatePrInput } from "@/hooks/use-create-pr";
import { CommitBox } from "@/components/commit-box";
import { CreatePrForm } from "@/components/create-pr-form";
import { ModeToggle } from "@/components/mode-toggle";
import { FileSection } from "@/components/file-section";
import { EmptyState } from "@/components/empty-state";
import { use_persistent_value } from "@/hooks/use-persistent-value";
import type { PrimaryMode } from "@/components/commit-box";

interface SourceControlPanelProps {
  status: GitStatus;
  stage: (path: string) => Promise<boolean>;
  unstage: (path: string) => Promise<boolean>;
  stage_all: () => Promise<boolean>;
  unstage_all: () => Promise<boolean>;
  commit: (message: string) => Promise<boolean>;
  sync: (op: "push" | "pull") => Promise<boolean>;
  create_pr: (input: CreatePrInput) => Promise<boolean>;
}

export function SourceControlPanel({
  status,
  stage,
  unstage,
  stage_all,
  unstage_all,
  commit,
  sync,
  create_pr,
}: SourceControlPanelProps) {
  const clean = status.staged.length === 0 && status.unstaged.length === 0;
  const [mode, set_mode] = use_persistent_value<PrimaryMode>("muxy.git.commitMode", "commit");
  const hasPr = !!status.pullRequest;
  const creating = mode === "pr" && !hasPr;

  return (
    <>
      <section className="flex flex-col gap-2 border-b border-border p-2.5">
        {!hasPr && <ModeToggle mode={mode} onChange={set_mode} />}
        {creating ? (
          <CreatePrForm baseBranch={status.defaultBranch} onSubmit={create_pr} />
        ) : (
          <CommitBox
            canCommit={status.staged.length > 0}
            onCommit={commit}
            onPull={() => sync("pull")}
            onPush={() => sync("push")}
          />
        )}
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
          onOpen={open_diff}
        />
        {clean && <EmptyState>No changes.</EmptyState>}
      </main>
    </>
  );
}
