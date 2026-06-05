import { useCallback, useState } from "react";
import { alert_error } from "@/lib/git";
import { run_pinned } from "@/lib/git-scope";
import { cleanup_branch, remove_worktree_or_branch } from "@/lib/git-cleanup";
import { merge_pr, close_pr, type MergeMethod } from "@/lib/git-prs";
import type { PrAction } from "@/components/current-pr-content";

export interface CleanupTarget {
  branch: string | null;
  defaultBranch: string | null;
  dirty: boolean;
}

export function use_pr_actions() {
  const [pending, set_pending] = useState<PrAction | null>(null);

  const merge = useCallback(
    async (number: number, method: MergeMethod, deleteBranch: boolean, target: CleanupTarget) => {
      set_pending(method);
      let cleanupProject: string | undefined;
      try {
        await run_pinned((project) => {
          cleanupProject = project;
          return merge_pr(number, method, false, project);
        });
      } catch (err) {
        await alert_error(`Could not merge PR #${number}`, err);
        set_pending(null);
        return false;
      }
      try {
        if (deleteBranch) {
          await remove_worktree_or_branch(
            { branch: target.branch, defaultBranch: target.defaultBranch, dirty: false },
            cleanupProject,
          );
        }
      } catch (err) {
        await alert_error(`PR #${number} merged, but branch cleanup failed`, err);
      } finally {
        set_pending(null);
      }
      return true;
    },
    [],
  );

  const close = useCallback(async (number: number) => {
    set_pending("close");
    try {
      await run_pinned((project) => close_pr(number, project));
      return true;
    } catch (err) {
      await alert_error(`Could not close PR #${number}`, err);
      return false;
    } finally {
      set_pending(null);
    }
  }, []);

  const cleanup = useCallback(async (target: CleanupTarget) => {
    set_pending("cleanup");
    try {
      return await cleanup_branch(target);
    } finally {
      set_pending(null);
    }
  }, []);

  return { pending, merge, close, cleanup };
}
