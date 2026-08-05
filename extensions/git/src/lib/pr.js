import * as repo from "@/lib/repo";
import { alertError, confirmAction, errorMessage, openUrl } from "@/lib/git";
const MAX_SLUG_WORDS = 5;
const MAX_SLUG_LENGTH = 30;
export function prState(pr) {
    const s = pr.state.toLowerCase();
    if (s === "merged")
        return "merged";
    if (s === "closed")
        return "closed";
    return "open";
}
export function mergePr(number, method, deleteBranch) {
    return repo.prMerge({ number, method, deleteBranch });
}
export function closePr(number) {
    return repo.prClose(number);
}
export function readyPr(number, title) {
    return repo.prReady({ number, title });
}
export function createPr(title, body, baseBranch, draft) {
    return repo.prCreate({ title, body, baseBranch, draft });
}
function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .split("-")
        .filter(Boolean)
        .slice(0, MAX_SLUG_WORDS)
        .join("-")
        .slice(0, MAX_SLUG_LENGTH)
        .replace(/-+$/g, "");
}
export function branchNameFromTitle(title) {
    const slug = slugify(title);
    const suffix = Date.now().toString(36).slice(-5);
    return slug ? `${slug}-${suffix}` : suffix;
}
export function existingPrUrl(err) {
    const message = errorMessage(err);
    if (!/already exists/i.test(message))
        return null;
    const match = message.match(/https?:\/\/\S+/);
    return match ? match[0].replace(/[.,)\]]+$/, "") : null;
}
async function pullQuietly() {
    await repo.pullFastForward().catch(() => undefined);
}
async function removeWorktree(root, branch, dirty) {
    const worktrees = await repo.worktreesList().catch(() => []);
    const others = worktrees.filter((w) => !w.isActive);
    const replacement = others.find((w) => w.isPrimary) ?? others[0];
    if (!replacement)
        throw new Error("No other worktree to remove from.");
    await muxy.git.worktree.switchTo({ identifier: replacement.path }).catch(() => undefined);
    await muxy.git.worktree.remove({ path: root, force: dirty });
    if (branch)
        await repo.branchDeleteRemote(branch).catch(() => undefined);
    await pullQuietly();
    await muxy.worktrees.refresh().catch(() => undefined);
}
export async function removeWorktreeOrBranch({ branch, defaultBranch, dirty }) {
    const info = await repo.repoInfo().catch(() => null);
    if (info?.isWorktree) {
        await removeWorktree(info.root, branch, dirty);
        return;
    }
    if (!branch)
        throw new Error("No branch to clean up.");
    if (branch === defaultBranch) {
        throw new Error(`"${branch}" is the default branch and won't be deleted.`);
    }
    const target = defaultBranch ?? "main";
    await repo.branchSwitch(target);
    const { currentBranch } = await repo.repoInfo();
    if (currentBranch === branch) {
        throw new Error(`Still on "${branch}" after switching to ${target}.`);
    }
    await repo.branchDelete(branch, true);
    await repo.branchDeleteRemote(branch).catch(() => undefined);
    await pullQuietly();
    await muxy.worktrees.refresh().catch(() => undefined);
}
export async function cleanupBranch(target) {
    if (!target.branch)
        return false;
    try {
        await removeWorktreeOrBranch(target);
        return true;
    }
    catch (err) {
        await alertError("Cleanup failed", err);
        return false;
    }
}
export function checkoutPr(number) {
    return repo.prCheckout(number);
}
export function parentDir(path) {
    return (path ?? "").replace(/\/+$/, "").replace(/\/[^/]+$/, "");
}
export function worktreePathIn(dir, number) {
    const name = `pr-${number}`;
    return dir ? `${dir.replace(/\/+$/, "")}/${name}` : name;
}
export async function checkoutPrWorktree(number, path) {
    const branch = await repo.prCheckoutWorktree(number, path);
    await muxy.worktrees.refresh().catch(() => undefined);
    return branch;
}
export async function confirmOpenExistingPr(err, refresh) {
    const url = existingPrUrl(err);
    if (!url)
        return false;
    const open = await confirmAction({
        title: "Pull request already exists",
        message: "A pull request for this branch already exists. Open it?",
        confirmLabel: "Open PR",
    });
    if (open)
        openUrl(url);
    await refresh();
    return true;
}
