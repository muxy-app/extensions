import * as git from "@/core/git";
import { makeEntry } from "@/core/status";
import { confirmAction, copyText, openInEditor, revealInFinder } from "@/shared/actions";
import { openDiffTab } from "@/shared/diff-tabs";

export function openDiff(ctl, entry, section) {
  void openDiffTab(ctl.root, { source: "working", focus: { path: entry.path, section } });
}

export function openFile(entry) {
  void openInEditor(entry.path);
}

function moved(entry, staged) {
  if (staged && entry.code === "U") return makeEntry({ ...entry, code: "A" });
  if (!staged && entry.code === "A") return makeEntry({ ...entry, code: "U" });
  return entry;
}

function optimistic(ctl, paths, staged) {
  const status = ctl.state.status;
  if (!status) return;
  const set = new Set(paths);
  const from = staged ? "unstaged" : "staged";
  const to = staged ? "staged" : "unstaged";
  const moving = [...status[from], ...status.conflicts].filter((entry) => set.has(entry.path));
  if (moving.length === 0) return;
  const keep = (list) => list.filter((entry) => !set.has(entry.path));
  const target = [...keep(status[to]), ...moving.map((entry) => moved(entry, staged))].sort((a, b) => (a.path < b.path ? -1 : 1));
  ctl.patchStatus({ ...status, conflicts: keep(status.conflicts), [from]: keep(status[from]), [to]: target });
}

export function stagePaths(ctl, paths) {
  if (!paths.length) return;
  optimistic(ctl, paths, true);
  return ctl.run("Could not stage changes", () => git.stage(paths));
}

export function unstagePaths(ctl, paths) {
  if (!paths.length) return;
  optimistic(ctl, paths, false);
  return ctl.run("Could not unstage changes", () => git.unstage(paths));
}

export function stageAll(ctl) {
  const status = ctl.state.status;
  if (!status) return;
  return stagePaths(ctl, [...status.unstaged, ...status.conflicts].map((entry) => entry.path));
}

export function unstageAll(ctl) {
  const status = ctl.state.status;
  if (status) return unstagePaths(ctl, status.staged.map((entry) => entry.path));
}

function discardMessage(entries, untracked) {
  if (entries.length === 1) {
    const path = entries[0].path;
    return untracked.length ? `“${path}” is untracked and will be deleted.` : `Your changes to “${path}” will be lost.`;
  }
  const tracked = entries.length - untracked.length;
  const parts = [];
  if (tracked) parts.push(`${tracked} file${tracked === 1 ? "" : "s"} will be reverted`);
  if (untracked.length) parts.push(`${untracked.length} untracked file${untracked.length === 1 ? "" : "s"} will be deleted`);
  return `${parts.join(" and ")}.`;
}

export async function discardEntries(ctl, entries) {
  if (!entries.length) return;
  const untracked = entries.filter((entry) => entry.code === "U").map((entry) => entry.path);
  const tracked = entries.filter((entry) => entry.code !== "U").map((entry) => entry.path);
  const single = entries.length === 1;
  const ok = await confirmAction({
    title: single ? "Discard changes?" : `Discard ${entries.length} changes?`,
    message: `${discardMessage(entries, untracked)} This can't be undone.`,
    confirmLabel: single && untracked.length ? "Delete File" : "Discard",
    critical: true,
  });
  if (ok) return ctl.run("Could not discard changes", () => git.discard(tracked, untracked));
}

export function discardAll(ctl) {
  const status = ctl.state.status;
  if (status) return discardEntries(ctl, status.unstaged);
}

export function resolveWith(ctl, entry, side) {
  return ctl.run("Could not resolve the conflict", async () => {
    await git.run(["git", "checkout", `--${side}`, "--", entry.path]);
    await git.stage([entry.path]);
  });
}

export function stashEntries(ctl, entries, label) {
  const paths = entries.map((entry) => entry.path);
  if (!paths.length) return;
  return ctl.run("Could not stash changes", () => git.stashPush(`Stash ${label}`, paths));
}

export function ignore(ctl, entry) {
  return ctl.run("Could not update .gitignore", () => git.ignorePath(entry.path));
}

export function reveal(path) {
  revealInFinder(path);
}

export function copyPath(entries) {
  void copyText(entries.map((entry) => entry.path).join("\n"), entries.length === 1 ? "Copied path" : `Copied ${entries.length} paths`);
}
