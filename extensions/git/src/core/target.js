const KEY = "git-custom.target";

let current = { cwd: "", root: "", gitDir: "" };
let pinned = null;
let lastDir = "";

export const getRoot = () => current.root;
export const getCwd = () => current.cwd;
export const lastTerminalDir = () => lastDir;

export function pickPane(panes, activeId) {
  const mine = activeId ? panes.filter((pane) => pane.worktreeID === activeId) : panes;
  return mine.find((pane) => pane.isFocused) ?? mine[0] ?? panes.find((pane) => pane.isFocused) ?? null;
}

export async function terminalDir() {
  const [panes, trees] = await Promise.all([muxy.panes.list().catch(() => []), muxy.worktrees.list().catch(() => [])]);
  const active = trees.find((tree) => tree.isActive);
  return pickPane(panes, active?.id)?.workingDirectory || active?.path || "";
}

export function parseProbe(stdout) {
  const [root, gitDir] = String(stdout ?? "").trim().split("\n");
  if (!root) return null;
  const dir = gitDir || `${root}/.git`;
  return { root, gitDir: dir, isWorktree: /\/worktrees\//.test(dir) };
}

async function probe(dir) {
  if (!dir) return null;
  const res = await muxy.exec(["git", "rev-parse", "--show-toplevel", "--absolute-git-dir"], { cwd: dir }).catch(() => null);
  return res?.exitCode === 0 ? parseProbe(res.stdout) : null;
}

async function remember() {
  try {
    await muxy.storage.set(KEY, current);
  } catch {}
}

async function recall() {
  try {
    return (await muxy.storage.get(KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function repoInfo({ follow = false } = {}) {
  let dir;
  if (follow) {
    dir = await terminalDir();
    lastDir = dir;
  } else {
    const saved = await recall();
    dir = saved?.root || saved?.cwd || (await terminalDir());
  }
  if (follow && pinned && pinned.forDir === dir) dir = pinned.root;
  else if (follow) pinned = null;
  const info = await probe(dir);
  current = { cwd: dir, root: info?.root ?? "", gitDir: info?.gitDir ?? "" };
  if (follow) await remember();
  if (!info) throw new Error("Not a git repository");
  return { ...info, cwd: dir };
}

export function pin(root) {
  pinned = { forDir: lastDir, root };
  current = { ...current, root };
}
