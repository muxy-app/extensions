import { strip_slash } from "@/lib/files";

let cachedCwd;
let resolvedCwd = false;

async function active_worktree_path() {
  if (resolvedCwd) return cachedCwd;
  try {
    const worktrees = await muxy.worktrees.list();
    const active = worktrees.find((w) => w.isActive) ?? worktrees.find((w) => w.isPrimary) ?? worktrees[0];
    cachedCwd = active?.path;
  } catch {
    cachedCwd = undefined;
  }
  resolvedCwd = true;
  return cachedCwd;
}

function invalidate() {
  resolvedCwd = false;
  cachedCwd = undefined;
}

muxy.events.subscribe("project.switched", invalidate);
muxy.events.subscribe("worktree.switched", invalidate);

export async function head_baseline(filePath) {
  const rel = strip_slash(filePath);
  if (!rel) return null;
  try {
    const cwd = await active_worktree_path();
    const res = await muxy.exec(["git", "show", `HEAD:${rel}`], { cwd });
    if (res.exitCode !== 0) return null;
    return res.stdout;
  } catch {
    return null;
  }
}
