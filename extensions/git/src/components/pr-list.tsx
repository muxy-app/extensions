import { useCallback, useEffect, useRef, useState } from "react";
import { GitPullRequest, Loader2, RefreshCw } from "lucide-react";
import { alert_error, confirm_action } from "@/lib/git";
import { run_pinned } from "@/lib/git-scope";
import { close_pr } from "@/lib/git-prs";
import { checkout_pr, checkout_pr_worktree } from "@/lib/pr-checkout";
import { use_persistent_value } from "@/hooks/use-persistent-value";
import { PrFilterTabs, type PrFilter } from "@/components/pr-filter-tabs";
import { PrRow } from "@/components/pr-row";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; prs: MuxyGitPRListItem[] };

export function PrList() {
  const [filter, set_filter] = use_persistent_value<PrFilter>("muxy.git.prs.filter", "open");
  const [state, set_state] = useState<State>({ kind: "idle" });
  const [refreshing, set_refreshing] = useState(false);
  const started = useRef(false);

  const load = useCallback(
    async (fresh = false) => {
      started.current = true;
      set_refreshing(true);
      set_state((s) => (s.kind === "ready" ? s : { kind: "loading" }));
      try {
        const prs = await muxy.git.pr.list({ filter, limit: 50, fresh });
        set_state({ kind: "ready", prs });
      } catch (err) {
        set_state({ kind: "error", message: error_text(err) });
      } finally {
        set_refreshing(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    if (!started.current) return;
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => started.current && void load();
    const off_project = muxy.events.subscribe("project.switched", refresh);
    const off_worktree = muxy.events.subscribe("worktree.switched", refresh);
    return () => {
      off_project?.();
      off_worktree?.();
    };
  }, [load]);

  const checkout = useCallback(async (number: number) => {
    const ok = await confirm_action({
      title: `Checkout PR #${number}?`,
      message: `This checks out the branch for pull request #${number} in the current worktree.`,
      confirmLabel: "Checkout",
    });
    if (!ok) return;
    try {
      await run_pinned((project) => checkout_pr(number, project));
      await muxy.worktrees.refresh().catch(() => undefined);
      await muxy.toast({ body: `Checked out PR #${number}`, variant: "success" });
    } catch (err) {
      await alert_error(`Could not checkout PR #${number}`, err);
    }
  }, []);

  const checkout_worktree = useCallback(async (number: number) => {
    const ok = await confirm_action({
      title: `Checkout PR #${number} to worktree?`,
      message: `This creates a new worktree for pull request #${number} and switches to it.`,
      confirmLabel: "Continue",
    });
    if (!ok) return;
    try {
      const branch = await run_pinned((project) => checkout_pr_worktree(number, project));
      if (branch) await muxy.toast({ body: `PR #${number} in worktree (${branch})`, variant: "success" });
    } catch (err) {
      await alert_error(`Could not create worktree for PR #${number}`, err);
    }
  }, []);

  const close = useCallback(
    async (number: number) => {
      const ok = await confirm_action({
        title: `Close PR #${number}?`,
        message: `This closes pull request #${number} without merging it.`,
        confirmLabel: "Close PR",
      });
      if (!ok) return;
      try {
        await run_pinned((project) => close_pr(number, project));
        await load(true);
      } catch (err) {
        await alert_error(`Could not close PR #${number}`, err);
      }
    },
    [load],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-[26px] shrink-0 items-center bg-background pl-2.5 pr-2">
        <span className="text-[12px] font-semibold text-muted-foreground">Pull Requests</span>
        {state.kind !== "idle" && (
          <button
            type="button"
            title="Refresh"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="ml-auto flex size-[18px] items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <RefreshCw size={12} strokeWidth={2} className={refreshing ? "animate-spin" : ""} />
          </button>
        )}
      </header>

      {state.kind === "idle" ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-[11px] font-medium text-foreground outline-none transition-colors hover:border-primary hover:bg-accent"
          >
            <GitPullRequest size={12} strokeWidth={2} />
            Load pull requests
          </button>
        </div>
      ) : (
        <>
          <PrFilterTabs value={filter} onChange={set_filter} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {state.kind === "loading" ? (
              <Centered>
                <Loader2 size={16} className="animate-spin" />
                Loading…
              </Centered>
            ) : state.kind === "error" ? (
              <Centered>
                <span className="max-w-[80%] text-center">{state.message}</span>
              </Centered>
            ) : state.prs.length === 0 ? (
              <Centered>
                <GitPullRequest size={20} strokeWidth={1.5} />
                No {filter === "all" ? "" : filter} pull requests.
              </Centered>
            ) : (
              <ul>
                {state.prs.map((pr) => (
                  <PrRow
                    key={pr.number}
                    pr={pr}
                    onCheckout={checkout}
                    onCheckoutWorktree={checkout_worktree}
                    onClose={close}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-[11px] text-muted-foreground">
      {children}
    </div>
  );
}

function error_text(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.trim() || "Could not load pull requests.";
}
