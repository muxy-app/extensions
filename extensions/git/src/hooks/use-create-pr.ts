import { useCallback } from "react";
import { alert_error, exec_git, active_worktree_path } from "@/lib/git";
import { create_pr } from "@/lib/git-prs";

export interface CreatePrInput {
  title: string;
  body: string;
  baseBranch?: string;
  newBranch?: string;
  draft?: boolean;
}

export function use_create_pr(refreshGit: () => Promise<void>) {
  return useCallback(
    async (input: CreatePrInput) => {
      try {
        if (input.newBranch) {
          await muxy.git.branch.create({ name: input.newBranch });
        }
        const pushed = await exec_git(
          await active_worktree_path(),
          ["push", "-u", "origin", "HEAD"],
          "Could not push branch",
        );
        if (!pushed) return false;
        await create_pr(input.title, input.body, input.baseBranch, input.draft ?? false);
        await refreshGit();
        return true;
      } catch (err) {
        await alert_error("Could not create pull request", err);
        return false;
      }
    },
    [refreshGit],
  );
}
