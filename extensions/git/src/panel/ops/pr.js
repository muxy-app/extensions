import * as git from "@/core/git";
import { forgeFor } from "@/core/forge";
import { prWorktreePath } from "@/core/forge/normalize";
import { cleanupBranch, confirmMerge } from "@/core/pr-flow";
import { alertError, confirmAction, copyText, openUrl, toast } from "@/shared/actions";
import { prState } from "@/core/forge/normalize";
import { openInput } from "@/shared/popover";
import { openDiffTab } from "@/shared/diff-tabs";

async function api(ctl) {
  return (await forgeFor(ctl.root)).api;
}

export function viewPr(ctl, pr) {
  void openDiffTab(ctl.root, { source: "pr", number: pr.number });
}

export async function mergePr(ctl, pr, method) {
  const current = !!ctl.state.status?.branch && pr.headBranch === ctl.state.status.branch;
  const choice = await confirmMerge(pr, method, current);
  if (!choice) return false;
  const forge = await api(ctl);
  const merged = await ctl.run(`Could not merge #${pr.number}`, () => forge.merge(pr.number, method));
  if (!merged.ok) return false;
  toast(`Merged #${pr.number}`);
  if (!choice.cleanup) return true;
  const { repo, status } = ctl.state;
  await ctl.run("Merged, but cleanup failed", () => cleanupBranch({ repo, status, branch: status?.branch }));
  return true;
}

export function prMoreMenu(ctl, pr, { onRefresh, onChanged } = {}) {
  const open = prState(pr) === "open";
  return [
    { label: "Open in Browser", run: () => openUrl(pr.url) },
    { label: "Copy Link", run: () => void copyText(pr.url, "Copied link") },
    onRefresh ? { label: "Refresh", run: onRefresh } : null,
    "-",
    { label: "Update Branch", disabled: !open || ctl.state.forge === "gitea", run: () => void updateBranch(ctl, pr).then((ok) => ok && onChanged?.()) },
    { label: "Close Pull Request…", danger: true, disabled: !open, run: () => void closePr(ctl, pr).then((ok) => ok && onChanged?.()) },
  ];
}

export async function closePr(ctl, pr) {
  const ok = await confirmAction({ title: `Close #${pr.number}?`, message: `“${pr.title}” is closed without merging.`, confirmLabel: "Close Pull Request", critical: true });
  if (!ok) return false;
  const forge = await api(ctl);
  return (await ctl.run(`Could not close #${pr.number}`, () => forge.close(pr.number))).ok;
}

export async function readyPr(ctl, pr) {
  const forge = await api(ctl);
  return (await ctl.run(`Could not mark #${pr.number} ready`, () => forge.ready(pr))).ok;
}

export async function updateBranch(ctl, pr) {
  const forge = await api(ctl);
  return (await ctl.run(`Could not update #${pr.number}`, () => forge.updateBranch(pr.number))).ok;
}

export async function cleanupCurrent(ctl) {
  const { repo, status } = ctl.state;
  const branch = status?.branch;
  if (!branch) return;
  const ok = await confirmAction({
    title: `Clean up “${branch}”?`,
    message: repo?.isWorktree
      ? "This worktree is removed and the branch is deleted locally and on the remote."
      : "You'll switch to the default branch, and this branch is deleted locally and on the remote.",
    confirmLabel: "Clean Up",
    critical: true,
  });
  if (ok) await ctl.run("Cleanup failed", () => cleanupBranch({ repo, status, branch }));
}

export async function checkoutPr(ctl, pr) {
  const dirty = (ctl.state.status?.staged.length ?? 0) + (ctl.state.status?.unstaged.length ?? 0) > 0;
  const ok = await confirmAction({
    title: `Check out #${pr.number}?`,
    message: `Switches this worktree to ${pr.headBranch || "the pull request's branch"}.${dirty ? " Your uncommitted changes come along." : ""}`,
    confirmLabel: "Check Out",
  });
  if (!ok) return false;
  const forge = await api(ctl);
  return (await ctl.run(`Could not check out #${pr.number}`, () => forge.checkout(pr.number))).ok;
}

async function primaryRoot(ctl) {
  const worktrees = await git.worktreeList(ctl.root);
  return worktrees.find((w) => w.primary)?.path ?? ctl.root;
}

export async function worktreePr(ctl, pr, anchor, onDone = () => {}) {
  const value = prWorktreePath(await primaryRoot(ctl), pr.number);
  openInput({
    anchor,
    title: `Check out #${pr.number} in a new worktree`,
    detail: "Folder for the new worktree:",
    value,
    confirm: "Create Worktree",
    onSubmit: (path) =>
      void ctl
        .run(`Could not create a worktree for #${pr.number}`, async () => {
          const forge = await api(ctl);
          await forge.checkoutWorktree(pr.number, path);
          await muxy.worktrees.refresh().catch(() => undefined);
          await muxy.git.worktree.switchTo({ identifier: path });
        })
        .then((result) => result.ok && onDone()),
  });
}

export async function createPr(ctl) {
  if (!ctl.state.status?.branch) {
    await alertError("No branch", "Switch to or create a branch before opening a pull request.");
    return null;
  }
  try {
    return await muxy.modal.openWebview({ entry: "modal/create-pr.html", width: 520, height: 440, dismissOnOutsideClick: false });
  } catch (err) {
    await alertError("Could not open the pull request form", err);
    return null;
  }
}
