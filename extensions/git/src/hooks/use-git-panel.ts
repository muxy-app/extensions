import { useCallback, useEffect, useRef, useState } from "react";
import { try_action, to_view_status, active_worktree_path } from "@/lib/git";
import { run_pinned, is_busy, on_busy_change } from "@/lib/git-scope";
import type { GitStatus } from "@/lib/git-status";

export type RepoState =
  | { kind: "loading" }
  | { kind: "no_repo" }
  | { kind: "ready"; status: GitStatus };

export function use_git_panel() {
  const [state, set_state] = useState<RepoState>({ kind: "loading" });
  const [switching, set_switching] = useState(false);
  const refresh_id = useRef(0);
  const cache = useRef(new Map<string, RepoState>());

  // Resolve the pull request over the network in the background and patch it in.
  // Never blocks the visible branch/file view; only applies if still on `branch`.
  const resolve_pr = useCallback(async (cwd: string | undefined, branch: string | null) => {
    let pr: MuxyGitPR | null = null;
    try {
      pr = await muxy.git.pr.info({ fresh: true });
    } catch {
      return;
    }
    set_state((prev) => {
      if (prev.kind !== "ready" || prev.status.branch !== branch) return prev;
      const next: RepoState = { kind: "ready", status: { ...prev.status, pullRequest: pr } };
      if (cwd) cache.current.set(cwd, next);
      return next;
    });
  }, []);

  // Fast, local-only status. Reuses the cached PR for the same branch so the view never
  // waits on the network. When `withPr` is set, resolves the PR in the background.
  const load_local = useCallback(
    async (withPr: boolean) => {
      const id = ++refresh_id.current;
      const cwd = await active_worktree_path();
      let next: RepoState;
      try {
        const status = to_view_status(await muxy.git.status({ local: true }));
        const prev = cwd ? cache.current.get(cwd) : undefined;
        if (prev?.kind === "ready" && prev.status.branch === status.branch) {
          status.pullRequest = prev.status.pullRequest;
          status.defaultBranch = prev.status.defaultBranch;
        }
        next = { kind: "ready", status };
      } catch {
        next = { kind: "no_repo" };
      }
      if (refresh_id.current !== id) return;
      if (cwd) cache.current.set(cwd, next);
      set_state(next);
      set_switching(false);
      if (withPr && next.kind === "ready") void resolve_pr(cwd, next.status.branch);
    },
    [resolve_pr],
  );

  // Public refresh: local status now, PR in the background.
  const refresh = useCallback(() => load_local(true), [load_local]);

  const pending_switch = useRef(false);

  const switch_scope = useCallback(async () => {
    if (is_busy()) {
      pending_switch.current = true;
      return;
    }
    const cwd = await active_worktree_path();
    const cached = cwd ? cache.current.get(cwd) : undefined;
    if (cached) set_state(cached);
    else set_switching(true);
    await load_local(true);
  }, [load_local]);

  const reconcile_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconcile = useCallback(() => {
    if (reconcile_timer.current) clearTimeout(reconcile_timer.current);
    reconcile_timer.current = setTimeout(async () => {
      reconcile_timer.current = null;
      if (is_busy()) return;
      const id = ++refresh_id.current;
      const cwd = await active_worktree_path();
      let next: RepoState;
      let branch_changed = false;
      try {
        const status = to_view_status(await muxy.git.status({ local: true }));
        const prev = cwd ? cache.current.get(cwd) : undefined;
        if (prev?.kind === "ready" && prev.status.branch === status.branch) {
          status.pullRequest = prev.status.pullRequest;
          status.defaultBranch = prev.status.defaultBranch;
        } else if (prev?.kind === "ready") {
          branch_changed = true;
        }
        next = { kind: "ready", status };
      } catch {
        next = { kind: "no_repo" };
      }
      if (refresh_id.current !== id) return;
      if (cwd) cache.current.set(cwd, next);
      set_state(next);
      if (branch_changed && next.kind === "ready") void resolve_pr(cwd, next.status.branch);
    }, 250);
  }, [resolve_pr]);

  const move_entry = useCallback(
    (path: string, from: "staged" | "unstaged", to: "staged" | "unstaged") => {
      set_state((prev) => {
        if (prev.kind !== "ready") return prev;
        const src = prev.status[from];
        const entry = src.find((e) => e.path === path);
        if (!entry) return prev;
        const moved =
          to === "staged"
            ? { ...entry, label: entry.label === "?" ? "A" : entry.label }
            : entry;
        return {
          kind: "ready",
          status: {
            ...prev.status,
            [from]: src.filter((e) => e.path !== path),
            [to]: [...prev.status[to], moved].sort((a, b) => a.path.localeCompare(b.path)),
          },
        };
      });
    },
    [],
  );

  const stage = useCallback(
    async (path: string) => {
      move_entry(path, "unstaged", "staged");
      const ok = await try_action(
        () => run_pinned((project) => muxy.git.stage({ paths: [path], project })),
        "Could not stage file",
      );
      if (ok) reconcile();
      else void load_local(false);
      return ok;
    },
    [move_entry, reconcile, load_local],
  );

  const unstage = useCallback(
    async (path: string) => {
      move_entry(path, "staged", "unstaged");
      const ok = await try_action(
        () => run_pinned((project) => muxy.git.unstage({ paths: [path], project })),
        "Could not unstage file",
      );
      if (ok) reconcile();
      else void load_local(false);
      return ok;
    },
    [move_entry, reconcile, load_local],
  );

  const discard = useCallback(
    async (path: string) => {
      const entry =
        state.kind === "ready" ? state.status.unstaged.find((e) => e.path === path) : undefined;
      const untracked = entry?.label === "?";
      const ok = await try_action(
        () =>
          run_pinned((project) =>
            muxy.git.discard(
              untracked ? { untrackedPaths: [path], project } : { paths: [path], project },
            ),
          ),
        "Could not discard file",
      );
      await load_local(false);
      return ok;
    },
    [state, load_local],
  );

  const discard_all = useCallback(async () => {
    if (state.kind !== "ready") return false;
    const paths = state.status.unstaged.filter((e) => e.label !== "?").map((e) => e.path);
    const untrackedPaths = state.status.unstaged.filter((e) => e.label === "?").map((e) => e.path);
    const ok = await try_action(
      () => run_pinned((project) => muxy.git.discard({ paths, untrackedPaths, project })),
      "Could not discard changes",
    );
    await load_local(false);
    return ok;
  }, [state, load_local]);

  const stage_all = useCallback(async () => {
    const ok = await try_action(
      () => run_pinned((project) => muxy.git.stage({ paths: [], project })),
      "Could not stage changes",
    );
    await load_local(false);
    return ok;
  }, [load_local]);

  const unstage_all = useCallback(async () => {
    const ok = await try_action(
      () => run_pinned((project) => muxy.git.unstage({ paths: [], project })),
      "Could not unstage changes",
    );
    await load_local(false);
    return ok;
  }, [load_local]);

  const commit = useCallback(
    async (message: string) => {
      const ok = await try_action(
        () => run_pinned((project) => muxy.git.commit({ message, project })),
        "Commit failed",
      );
      if (ok) await load_local(false);
      return ok;
    },
    [load_local],
  );

  const sync = useCallback(
    async (op: "push" | "pull") => {
      const ok = await try_action(
        () =>
          run_pinned((project) =>
            op === "push" ? muxy.git.push({ project }) : muxy.git.pull({ project }),
          ),
        op === "push" ? "Push failed" : "Pull failed",
      );
      if (ok) await load_local(true);
      return ok;
    },
    [load_local],
  );

  useEffect(() => {
    void load_local(true);
    const off_project = muxy.events.subscribe("project.switched", () => void switch_scope());
    const off_worktree = muxy.events.subscribe("worktree.switched", () => void switch_scope());
    const off_file = muxy.events.subscribe("file.changed", () => reconcile());
    const off_busy = on_busy_change((busy) => {
      if (busy || !pending_switch.current) return;
      pending_switch.current = false;
      void switch_scope();
    });
    return () => {
      off_project?.();
      off_worktree?.();
      off_file?.();
      off_busy();
      if (reconcile_timer.current) clearTimeout(reconcile_timer.current);
    };
  }, [load_local, switch_scope, reconcile]);

  return {
    state,
    switching,
    refresh,
    stage,
    unstage,
    stage_all,
    unstage_all,
    discard,
    discard_all,
    commit,
    sync,
  };
}
