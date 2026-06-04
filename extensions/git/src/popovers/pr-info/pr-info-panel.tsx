import { useCallback, useEffect, useState } from "react";
import { GitPullRequest, Loader2 } from "lucide-react";
import { alert_error } from "@/lib/git";
import { cleanup_branch } from "@/lib/git-cleanup";
import { merge_pr, close_pr, type MergeMethod } from "@/lib/git-prs";
import { CurrentPrContent } from "@/components/current-pr-content";

type State =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; pr: MuxyGitPR; branch: string | null; defaultBranch: string | null; dirty: boolean };

export function PrInfoPanel() {
  const [state, set_state] = useState<State>({ kind: "loading" });
  const [busy, set_busy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await muxy.git.status();
      set_state(
        s.pullRequest
          ? {
              kind: "ready",
              pr: s.pullRequest,
              branch: s.branch || null,
              defaultBranch: s.defaultBranch,
              dirty: s.stagedFiles.length > 0 || s.unstagedFiles.length > 0,
            }
          : { kind: "none" },
      );
    } catch {
      set_state({ kind: "none" });
    }
  }, []);

  useEffect(() => {
    void load();
    const off_project = muxy.events.subscribe("project.switched", () => void load());
    const off_worktree = muxy.events.subscribe("worktree.switched", () => void load());
    return () => {
      off_project?.();
      off_worktree?.();
    };
  }, [load]);

  const merge = useCallback(async (number: number, method: MergeMethod, deleteBranch: boolean) => {
    set_busy(true);
    try {
      await merge_pr(number, method, deleteBranch);
      return true;
    } catch (err) {
      await alert_error(`Could not merge PR #${number}`, err);
      return false;
    } finally {
      set_busy(false);
    }
  }, []);

  const close = useCallback(async (number: number) => {
    set_busy(true);
    try {
      await close_pr(number);
      return true;
    } catch (err) {
      await alert_error(`Could not close PR #${number}`, err);
      return false;
    } finally {
      set_busy(false);
    }
  }, []);

  const cleanup = useCallback(async () => {
    if (state.kind !== "ready") return false;
    set_busy(true);
    try {
      return await cleanup_branch({
        branch: state.branch,
        defaultBranch: state.defaultBranch,
        dirty: state.dirty,
      });
    } finally {
      set_busy(false);
    }
  }, [state]);

  return (
    <div className="flex min-h-[13rem] w-72 flex-col p-3 text-popover-foreground">
      {state.kind === "loading" ? (
        <span className="flex flex-1 items-center justify-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </span>
      ) : state.kind === "none" ? (
        <span className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
          <GitPullRequest size={18} strokeWidth={1.5} />
          No pull request for this branch.
        </span>
      ) : (
        <CurrentPrContent
          pr={state.pr}
          busy={busy}
          onMerge={(method, deleteBranch) => merge(state.pr.number, method, deleteBranch)}
          onClose={close}
          onCleanup={cleanup}
          onDone={() => void muxy.popover.close()}
        />
      )}
    </div>
  );
}
