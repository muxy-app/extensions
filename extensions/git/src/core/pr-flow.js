import * as git from "@/core/git";
import { ask, confirmAction } from "@/shared/actions";

const METHOD_LABEL = { merge: "Merge", squash: "Squash and merge", rebase: "Rebase and merge" };

const METHOD_KEY = "muxy.git.merge-method";

export function mergeMethod() {
  try {
    const value = localStorage.getItem(METHOD_KEY);
    return ["merge", "squash", "rebase"].includes(value) ? value : "squash";
  } catch {
    return "squash";
  }
}

export function setMergeMethod(value) {
  try {
    localStorage.setItem(METHOD_KEY, value);
  } catch {}
}

export function methodLabel(method) {
  return METHOD_LABEL[method] ?? METHOD_LABEL.merge;
}

export async function confirmMerge(pr, method, canCleanup = true) {
  const choice = await ask({
    title: `${methodLabel(method)} #${pr.number}?`,
    message: canCleanup
      ? `“${pr.title}” will be merged into ${pr.baseBranch || "its base branch"}.\n\nClean Up also switches away from ${pr.headBranch || "the branch"} and deletes it locally and on the remote.`
      : `“${pr.title}” will be merged into ${pr.baseBranch || "its base branch"}.`,
    buttons: canCleanup ? ["Merge", "Merge & Clean Up"] : ["Merge"],
  });
  if (!choice) return null;
  return { cleanup: choice === "Merge & Clean Up" };
}

async function removeWorktree(repo, branch, dirty) {
  const worktrees = await git.worktreeList(repo.root);
  const target = worktrees.find((w) => w.primary && !w.active) ?? worktrees.find((w) => !w.active);
  if (!target) throw new Error("There is no other worktree to switch to.");
  if (dirty) {
    const ok = await confirmAction({
      title: "Remove a worktree with uncommitted changes?",
      message: `${repo.root} has uncommitted changes. Removing it deletes them permanently.`,
      confirmLabel: "Remove Anyway",
      critical: true,
    });
    if (!ok) return false;
  }
  await muxy.git.worktree.switchTo({ identifier: target.path });
  await muxy.git.worktree.remove({ path: repo.root, force: dirty });
  if (branch) {
    await git.deleteBranch(branch, true).catch(() => undefined);
    await git.deleteRemoteBranch(branch).catch(() => undefined);
  }
  await muxy.worktrees.refresh().catch(() => undefined);
  return true;
}

async function removeBranch(status, branch) {
  const base = await git.defaultBranchOf(status);
  if (!base) throw new Error("Could not find the repository's default branch to switch to.");
  if (base === branch) throw new Error(`“${branch}” is the default branch and won't be deleted.`);
  await git.switchBranch(base);
  await git.fetch().catch(() => undefined);
  await git.integrate("ff").catch(() => undefined);
  await git.deleteBranch(branch, true);
  await git.deleteRemoteBranch(branch).catch(() => undefined);
  return true;
}

export async function cleanupBranch({ repo, status, branch }) {
  if (!branch) throw new Error("There is no branch to clean up.");
  const dirty = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) + (status?.conflicts.length ?? 0) > 0;
  if (repo?.isWorktree) return removeWorktree(repo, branch, dirty);
  if (dirty) {
    const ok = await confirmAction({
      title: "Uncommitted changes",
      message: `Your uncommitted changes will move with you to the default branch, and “${branch}” will be deleted.`,
      confirmLabel: "Continue",
    });
    if (!ok) return false;
  }
  return removeBranch(status, branch);
}
