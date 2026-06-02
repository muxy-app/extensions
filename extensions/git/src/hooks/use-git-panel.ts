import { useCallback, useEffect, useRef, useState } from "react";
import { toast, resolve_cwd, run_git } from "@/lib/git";
import { apply_stats, parse_numstat, parse_status, type GitStatus } from "@/lib/git-status";
import { list_branches, type BranchList } from "@/lib/git-branches";

export type RepoState =
  | { kind: "loading" }
  | { kind: "no_repo" }
  | { kind: "ready"; status: GitStatus };

export function use_git_panel() {
  const [state, set_state] = useState<RepoState>({ kind: "loading" });
  const cwd = useRef<string | undefined>(undefined);
  const refresh_id = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++refresh_id.current;
    const current = () => refresh_id.current === id;

    cwd.current = await resolve_cwd();
    const probe = await run_git(cwd.current, ["rev-parse", "--is-inside-work-tree"], {
      quiet: true,
    });
    if (!current()) return;
    if (!probe.ok || probe.stdout.trim() !== "true") {
      set_state({ kind: "no_repo" });
      return;
    }
    const [res, staged_diff, unstaged_diff] = await Promise.all([
      run_git(cwd.current, ["status", "--porcelain=v2", "--branch", "--untracked-files=all"]),
      run_git(cwd.current, ["diff", "--cached", "--numstat"], { quiet: true }),
      run_git(cwd.current, ["diff", "--numstat"], { quiet: true }),
    ]);
    if (!current() || !res.ok) return;
    const status = parse_status(res.stdout);
    if (staged_diff.ok) apply_stats(status.staged, parse_numstat(staged_diff.stdout));
    if (unstaged_diff.ok) apply_stats(status.unstaged, parse_numstat(unstaged_diff.stdout));

    set_state({ kind: "ready", status });

    const untracked = status.unstaged.filter((e) => e.label === "?");
    if (untracked.length === 0) return;
    for (const entry of untracked) {
      if (!current()) return;
      const out = await run_git(
        cwd.current,
        ["diff", "--no-index", "--numstat", "--", "/dev/null", entry.path],
        { quiet: true },
      );
      const stat = parse_numstat(out.stdout).values().next().value;
      if (stat) {
        entry.added = stat.added;
        entry.removed = stat.removed;
      }
    }
    if (!current()) return;

    set_state({ kind: "ready", status: { ...status } });
  }, []);

  const reconcile_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconcile = useCallback(() => {
    if (reconcile_timer.current) clearTimeout(reconcile_timer.current);
    reconcile_timer.current = setTimeout(() => {
      reconcile_timer.current = null;
      void refresh();
    }, 250);
  }, [refresh]);

  const run_action = useCallback(
    async (args: string[]) => {
      const res = await run_git(cwd.current, args);
      if (res.ok) await refresh();
      return res;
    },
    [refresh],
  );

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
      const res = await run_git(cwd.current, ["add", "--", path]);
      if (res.ok) reconcile();
      else void refresh();
      return res;
    },
    [move_entry, reconcile, refresh],
  );

  const unstage = useCallback(
    async (path: string) => {
      move_entry(path, "staged", "unstaged");
      const res = await run_git(cwd.current, ["reset", "-q", "HEAD", "--", path]);
      if (res.ok) reconcile();
      else void refresh();
      return res;
    },
    [move_entry, reconcile, refresh],
  );

  const sync = useCallback(
    async (args: string[], success: string) => {
      const res = await run_git(cwd.current, args);
      if (res.ok) {
        toast(success);
        await refresh();
      }
      return res;
    },
    [refresh],
  );

  const get_branches = useCallback((): Promise<BranchList> => list_branches(cwd.current), []);

  const checkout = useCallback(
    async (name: string, create: boolean) => {
      const args = create ? ["checkout", "-b", name] : ["checkout", name];
      const res = await run_git(cwd.current, args);
      if (res.ok) {
        toast(create ? `Created branch ${name}` : `Switched to ${name}`);
        await refresh();
      }
      return res;
    },
    [refresh],
  );

  const delete_branch = useCallback(
    async (name: string) => {
      const res = await run_git(cwd.current, ["branch", "-D", name]);
      if (res.ok) toast(`Deleted branch ${name}`);
      return res;
    },
    [],
  );

  useEffect(() => {
    void refresh();
    const off_project = muxy.events.subscribe("project.switched", () => void refresh());
    const off_worktree = muxy.events.subscribe("worktree.switched", () => void refresh());
    return () => {
      off_project?.();
      off_worktree?.();
      if (reconcile_timer.current) clearTimeout(reconcile_timer.current);
    };
  }, [refresh]);

  return { state, refresh, run_action, stage, unstage, sync, get_branches, checkout, delete_branch };
}
