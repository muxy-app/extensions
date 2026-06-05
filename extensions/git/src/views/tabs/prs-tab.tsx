import type { GitStatus } from "@/lib/git-status";
import type { CreatePrInput } from "@/hooks/use-create-pr";
import type { use_pr_actions } from "@/hooks/use-pr-actions";
import { CreatePrForm } from "@/components/create-pr-form";
import { CurrentPrContent } from "@/components/current-pr-content";
import { PrList } from "@/components/pr-list";

interface PrsTabProps {
  status: GitStatus;
  create_pr: (input: CreatePrInput) => Promise<boolean>;
  pr_actions: ReturnType<typeof use_pr_actions>;
  refresh_all: () => void;
}

export function PrsTab({ status, create_pr, pr_actions, refresh_all }: PrsTabProps) {
  const pr = status.pullRequest;
  const dirty = status.staged.length > 0 || status.unstaged.length > 0;
  const target = { branch: status.branch, defaultBranch: status.defaultBranch, dirty };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="flex flex-col gap-2 border-b border-border p-2.5">
        {pr ? (
          <CurrentPrContent
            pr={pr}
            branch={status.branch}
            defaultBranch={status.defaultBranch}
            dirty={dirty}
            pending={pr_actions.pending}
            onMerge={(method, deleteBranch) =>
              pr_actions.merge(pr.number, method, deleteBranch, target)
            }
            onClose={pr_actions.close}
            onCleanup={() => pr_actions.cleanup(target)}
            onDone={refresh_all}
          />
        ) : (
          <CreatePrForm baseBranch={status.defaultBranch} onSubmit={create_pr} />
        )}
      </section>
      <PrList />
    </div>
  );
}
