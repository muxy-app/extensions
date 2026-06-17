// Resolves the absolute path of the active worktree root and caches it until
// the project or worktree changes. Several features (git baseline, image
// viewer) need this to run `muxy.exec` against absolute file paths, since the
// paths handed out by `muxy.files` are relative to this root.

let cachedRoot;
let resolved = false;

export async function worktree_root() {
  if (resolved) return cachedRoot;
  try {
    const worktrees = await muxy.worktrees.list();
    const active =
      worktrees.find((w) => w.isActive) ?? worktrees.find((w) => w.isPrimary) ?? worktrees[0];
    cachedRoot = active?.path;
  } catch {
    cachedRoot = undefined;
  }
  resolved = true;
  return cachedRoot;
}

function invalidate() {
  resolved = false;
  cachedRoot = undefined;
}

muxy.events.subscribe("project.switched", invalidate);
muxy.events.subscribe("worktree.switched", invalidate);
