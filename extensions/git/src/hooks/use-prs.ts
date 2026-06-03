import { useCallback, useEffect, useRef, useState } from "react";
import { alert_error, exec_git, active_worktree_path } from "@/lib/git";
import {
  checkout_pr_here,
  checkout_pr_worktree,
  close_pr,
  create_pr,
  list_prs,
  merge_pr,
  type MergeMethod,
} from "@/lib/git-prs";
import { read_pr_cache, write_pr_cache } from "@/lib/pr-cache";

export interface CreatePrInput {
  title: string;
  body: string;
  baseBranch?: string;
  newBranch?: string;
}

export type PrsState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; prs: MuxyGitPRListItem[] };

export function use_prs(active: boolean, refreshGit: () => Promise<void>) {
  const [state, set_state] = useState<PrsState>({ kind: "loading" });
  const [refreshing, set_refreshing] = useState(false);
  const [busy, set_busy] = useState<number | null>(null);
  const loaded = useRef(false);
  const refresh_id = useRef(0);

  const load = useCallback(async () => {
    const id = ++refresh_id.current;
    const current = () => refresh_id.current === id;
    const key = await active_worktree_path();
    const cached = read_pr_cache(key);
    if (!current()) return;
    set_state(cached ? { kind: "ready", prs: cached } : { kind: "idle" });
  }, []);

  const refresh = useCallback(async () => {
    const id = ++refresh_id.current;
    const current = () => refresh_id.current === id;
    set_refreshing(true);
    try {
      const key = await active_worktree_path();
      const prs = await list_prs();
      if (!current()) return;
      write_pr_cache(key, prs);
      set_state({ kind: "ready", prs });
    } catch {
      if (current() && read_pr_cache(await active_worktree_path()) === null) {
        set_state({ kind: "unavailable" });
      }
    } finally {
      if (current()) set_refreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    if (loaded.current) {
      void load();
    } else {
      loaded.current = true;
      void refresh();
    }
  }, [active, load, refresh]);

  useEffect(() => {
    const reload = () => {
      if (active) void load();
    };
    const off_project = muxy.events.subscribe("project.switched", reload);
    const off_worktree = muxy.events.subscribe("worktree.switched", reload);
    return () => {
      off_project?.();
      off_worktree?.();
    };
  }, [active, load]);

  const checkout_here = useCallback(
    async (pr: MuxyGitPRListItem) => {
      set_busy(pr.number);
      try {
        await checkout_pr_here(pr.number);
        await refreshGit();
      } catch (err) {
        await alert_error(`Could not checkout PR #${pr.number}`, err);
      } finally {
        set_busy(null);
      }
    },
    [refreshGit],
  );

  const checkout_worktree = useCallback(async (pr: MuxyGitPRListItem) => {
    set_busy(pr.number);
    try {
      const path = await worktree_path(pr.headBranch || `pr-${pr.number}`);
      if (!path) {
        await alert_error(
          `Could not checkout PR #${pr.number}`,
          new Error("Could not resolve a location for the new worktree."),
        );
        return;
      }
      await checkout_pr_worktree(pr.number, path);
      await muxy.worktrees.refresh();
      await muxy.git.worktree.switchTo({ identifier: path }).catch(() =>
        muxy.worktrees.switchTo(path),
      );
    } catch (err) {
      await alert_error(`Could not checkout PR #${pr.number}`, err);
    } finally {
      set_busy(null);
    }
  }, []);

  const merge = useCallback(
    async (number: number, method: MergeMethod, deleteBranch: boolean) => {
      set_busy(number);
      try {
        await merge_pr(number, method, deleteBranch);
        await Promise.all([refresh(), refreshGit()]);
        return true;
      } catch (err) {
        await alert_error(`Could not merge PR #${number}`, err);
        return false;
      } finally {
        set_busy(null);
      }
    },
    [refresh, refreshGit],
  );

  const close = useCallback(
    async (number: number) => {
      set_busy(number);
      try {
        await close_pr(number);
        await Promise.all([refresh(), refreshGit()]);
        return true;
      } catch (err) {
        await alert_error(`Could not close PR #${number}`, err);
        return false;
      } finally {
        set_busy(null);
      }
    },
    [refresh, refreshGit],
  );

  const create = useCallback(
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
        await create_pr(input.title, input.body, input.baseBranch);
        await Promise.all([refresh(), refreshGit()]);
        return true;
      } catch (err) {
        await alert_error("Could not create pull request", err);
        return false;
      }
    },
    [refresh, refreshGit],
  );

  return {
    state,
    refreshing,
    busy,
    refresh,
    checkout_here,
    checkout_worktree,
    merge,
    close,
    create,
  };
}

async function worktree_path(branch: string): Promise<string | null> {
  const slug = branch.replace(/\//g, "-");
  const existing = await muxy.worktrees.list().catch(() => [] as MuxyWorktree[]);
  const sibling = existing.find((w) => !w.isPrimary)?.path;
  if (sibling) return join(parent(sibling), slug);

  const primary = existing.find((w) => w.isPrimary)?.path ?? existing[0]?.path;
  if (primary) return join(parent(primary), `${base(primary)}-worktrees`, slug);
  return null;
}

function parent(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

function base(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function join(...parts: string[]): string {
  return parts.map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, ""))).join("/");
}
