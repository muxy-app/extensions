import { useCallback, useEffect, useRef, useState } from "react";
import { try_action, to_view_status, active_worktree_path } from "@/lib/git";
import { sync_status_bar } from "@/lib/status-bar";
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

  const refresh = useCallback(async () => {
    const id = ++refresh_id.current;
    const current = () => refresh_id.current === id;
    const key = await active_worktree_path();
    let next: RepoState;
    try {
      next = { kind: "ready", status: to_view_status(await muxy.git.status()) };
    } catch {
      next = { kind: "no_repo" };
    }
    if (key) cache.current.set(key, next);
    if (current()) {
      set_state(next);
      set_switching(false);
    }
  }, []);

  const switch_scope = useCallback(async () => {
    const id = ++refresh_id.current;
    const current = () => refresh_id.current === id;
    const key = await active_worktree_path();
    if (!current()) return;

    const cached = key ? cache.current.get(key) : undefined;
    if (cached) {
      set_state(cached);
      set_switching(false);
    } else {
      set_state({ kind: "loading" });
      set_switching(true);
    }

    let next: RepoState;
    try {
      next = { kind: "ready", status: to_view_status(await muxy.git.status()) };
    } catch {
      next = { kind: "no_repo" };
    }
    if (key) cache.current.set(key, next);
    if (current()) {
      set_state(next);
      set_switching(false);
    }
  }, []);

  const reconcile_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconcile = useCallback(() => {
    if (reconcile_timer.current) clearTimeout(reconcile_timer.current);
    reconcile_timer.current = setTimeout(() => {
      reconcile_timer.current = null;
      void refresh();
    }, 250);
  }, [refresh]);

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
      const ok = await try_action(() => muxy.git.stage({ paths: [path] }), "Could not stage file");
      if (ok) reconcile();
      else void refresh();
      return ok;
    },
    [move_entry, reconcile, refresh],
  );

  const unstage = useCallback(
    async (path: string) => {
      move_entry(path, "staged", "unstaged");
      const ok = await try_action(() => muxy.git.unstage({ paths: [path] }), "Could not unstage file");
      if (ok) reconcile();
      else void refresh();
      return ok;
    },
    [move_entry, reconcile, refresh],
  );

  const stage_all = useCallback(async () => {
    const ok = await try_action(() => muxy.git.stage({ paths: [] }), "Could not stage changes");
    await refresh();
    return ok;
  }, [refresh]);

  const unstage_all = useCallback(async () => {
    const ok = await try_action(() => muxy.git.unstage({ paths: [] }), "Could not unstage changes");
    await refresh();
    return ok;
  }, [refresh]);

  const commit = useCallback(
    async (message: string) => {
      const ok = await try_action(() => muxy.git.commit({ message }), "Commit failed");
      if (ok) await refresh();
      return ok;
    },
    [refresh],
  );

  const sync = useCallback(
    async (op: "push" | "pull") => {
      const ok = await try_action(
        () => (op === "push" ? muxy.git.push() : muxy.git.pull()),
        op === "push" ? "Push failed" : "Pull failed",
      );
      if (ok) await refresh();
      return ok;
    },
    [refresh],
  );

  useEffect(() => {
    sync_status_bar(state.kind === "ready" ? state.status : null);
  }, [state]);

  useEffect(() => {
    void refresh();
    const off_project = muxy.events.subscribe("project.switched", () => void switch_scope());
    const off_worktree = muxy.events.subscribe("worktree.switched", () => void switch_scope());
    const off_file = muxy.events.subscribe("file.changed", () => reconcile());
    return () => {
      off_project?.();
      off_worktree?.();
      off_file?.();
      if (reconcile_timer.current) clearTimeout(reconcile_timer.current);
    };
  }, [refresh, switch_scope, reconcile]);

  return {
    state,
    switching,
    refresh,
    stage,
    unstage,
    stage_all,
    unstage_all,
    commit,
    sync,
  };
}
