import { useCallback, useEffect, useRef, useState } from "react";
import { toast, resolve_cwd, run_git } from "@/lib/git";
import { gh_available, type PrInfo, type PrListItem } from "@/lib/gh";
import {
  checkout_pr_here,
  checkout_pr_worktree,
  local_branch_name,
  list_prs,
  view_pr,
} from "@/lib/git-prs";
import { read_pr_cache, write_pr_cache } from "@/lib/pr-cache";

export type PrsState =
  | { kind: "loading" }
  | { kind: "no_gh" }
  | { kind: "ready"; prs: PrListItem[] };

export function use_prs(active: boolean, refreshGit: () => Promise<void>) {
  const [state, set_state] = useState<PrsState>({ kind: "loading" });
  const [refreshing, set_refreshing] = useState(false);
  const [busy, set_busy] = useState<number | null>(null);
  const cwd = useRef<string | undefined>(undefined);
  const loaded = useRef(false);
  const refresh_id = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++refresh_id.current;
    const current = () => refresh_id.current === id;
    set_refreshing(true);
    try {
      cwd.current = await resolve_cwd();

      const cached = read_pr_cache(cwd.current);
      if (cached && current()) set_state({ kind: "ready", prs: cached });

      if (!(await gh_available(cwd.current))) {
        if (current()) set_state({ kind: "no_gh" });
        return;
      }
      const prs = await list_prs(cwd.current);
      if (!current()) return;
      write_pr_cache(cwd.current, prs);
      set_state({ kind: "ready", prs });
    } finally {
      if (current()) set_refreshing(false);
    }
  }, []);

  useEffect(() => {
    if (active && !loaded.current) {
      loaded.current = true;
      void refresh();
    }
  }, [active, refresh]);

  const detail = useCallback((number: number): Promise<PrInfo | null> => {
    return view_pr(cwd.current, number);
  }, []);

  const checkout_here = useCallback(
    async (pr: PrListItem) => {
      set_busy(pr.number);
      try {
        const res = await checkout_pr_here(cwd.current, pr.number);
        if (res.ok) {
          toast(`Checked out PR #${pr.number}`);
          await refreshGit();
        }
      } finally {
        set_busy(null);
      }
    },
    [refreshGit],
  );

  const checkout_worktree = useCallback(async (pr: PrListItem) => {
    set_busy(pr.number);
    try {
      const path = await worktree_path(cwd.current, local_branch_name({
        number: pr.number,
        headBranch: pr.headBranch,
        headRepositoryNameWithOwner: "",
      }));
      if (!path) {
        toast("Could not resolve worktree location", "error");
        return;
      }
      const res = await checkout_pr_worktree(cwd.current, pr.number, path);
      if (res.ok && res.path && res.branch) {
        toast(`Created worktree for PR #${pr.number}`);
        await muxy.worktrees.refresh();
        await muxy.worktrees.switchTo(res.path).catch(() => muxy.worktrees.switchTo(res.branch!));
      }
    } finally {
      set_busy(null);
    }
  }, []);

  return { state, refreshing, busy, refresh, detail, checkout_here, checkout_worktree };
}

async function worktree_path(
  cwd: string | undefined,
  branch: string,
): Promise<string | null> {
  const slug = branch.replace(/\//g, "-");
  const existing = await muxy.worktrees.list().catch(() => [] as never[]);
  const sibling = existing.find((w) => !w.isPrimary)?.path;
  if (sibling) return join(parent(sibling), slug);

  const common = await run_git(cwd, ["rev-parse", "--git-common-dir"], { quiet: true });
  if (common.ok && common.stdout.trim()) {
    const gitDir = common.stdout.trim();
    const repoRoot = gitDir.endsWith("/.git") ? gitDir.slice(0, -5) : parent(gitDir);
    return join(parent(repoRoot), `${base(repoRoot)}-worktrees`, slug);
  }
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
