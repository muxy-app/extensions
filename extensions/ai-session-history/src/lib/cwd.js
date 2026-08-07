/** Resolve the active worktree path, falling back to the active project path. */
export async function activeCwd() {
  try {
    const worktrees = await muxy.worktrees.list();
    const wt = worktrees.find((w) => w.isActive);
    if (wt?.path) return wt.path;
  } catch {
    // worktrees may be unavailable outside a git project
  }
  const projects = await muxy.projects.list();
  return projects.find((p) => p.isActive)?.path ?? null;
}

export function shortPath(path, max = 48) {
  if (!path) return "";
  if (path.length <= max) return path;
  return "…" + path.slice(-(max - 1));
}
