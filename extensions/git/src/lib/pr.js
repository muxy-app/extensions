import * as cmd from "@/lib/cmd";
import { alertError, confirmAction, errorMessage, openUrl, samePath } from "@/lib/git";
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
export function mergePr(number, method, deleteBranch, cwd) {
    return cmd.prMerge(cwd, { number, method, deleteBranch });
}
export function closePr(number, cwd) {
    return cmd.prClose(cwd, number);
}
export function createPr(title, body, baseBranch, draft, cwd) {
    return cmd.prCreate(cwd, { title, body, baseBranch, draft });
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
async function pullQuietly(cwd) {
    await cmd.pull(cwd).catch(() => undefined);
}
async function isOnWorktree(cwd) {
    const info = await cmd.repoInfo(cwd).catch(() => null);
    return !!info?.isWorktree;
}
function replacementWorktree(worktrees, cwd) {
    const others = worktrees.filter((w) => !samePath(w.path, cwd));
    return others.find((w) => w.isPrimary) ?? others[0];
}
async function removeWorktree(branch, dirty, cwd) {
    const worktrees = await cmd.worktreesList(cwd).catch(() => []);
    const replacement = replacementWorktree(worktrees, cwd);
    if (!replacement)
        throw new Error("No other worktree to remove from.");
    await muxy.git.worktree.switchTo({ identifier: replacement.path }).catch(() => undefined);
    await muxy.git.worktree.remove({ path: cwd, force: dirty });
    if (branch)
        await cmd.branchDeleteRemote(replacement.path, branch).catch(() => undefined);
    await pullQuietly(replacement.path);
    await muxy.worktrees.refresh().catch(() => undefined);
}
export async function removeWorktreeOrBranch({ branch, defaultBranch, dirty }, cwd) {
    if (await isOnWorktree(cwd)) {
        await removeWorktree(branch, dirty, cwd);
        return;
    }
    if (!branch)
        throw new Error("No branch to clean up.");
    if (branch === defaultBranch) {
        throw new Error(`"${branch}" is the default branch and won't be deleted.`);
    }
    const target = defaultBranch ?? "main";
    await cmd.branchSwitch(cwd, target);
    const { currentBranch } = await cmd.repoInfo(cwd);
    if (currentBranch === branch) {
        throw new Error(`Still on "${branch}" after switching to ${target}.`);
    }
    await cmd.branchDelete(cwd, branch, true);
    await cmd.branchDeleteRemote(cwd, branch).catch(() => undefined);
    await pullQuietly(cwd);
    await muxy.worktrees.refresh().catch(() => undefined);
}
export async function cleanupBranch(target, cwd) {
    if (!target.branch)
        return false;
    try {
        await removeWorktreeOrBranch(target, cwd);
        return true;
    }
    catch (err) {
        await alertError("Cleanup failed", err);
        return false;
    }
}
export function checkoutPr(number, cwd) {
    return cmd.prCheckout(cwd, number);
}
export function parentDir(path) {
    return (path ?? "").replace(/\/+$/, "").replace(/\/[^/]+$/, "");
}
export function worktreePathIn(dir, number) {
    const name = `pr-${number}`;
    return dir ? `${dir.replace(/\/+$/, "")}/${name}` : name;
}
export async function checkoutPrWorktree(number, path, cwd) {
    const branch = await cmd.prepareWorktreeBranch(cwd, number);
    await muxy.git.worktree.add({ path, branch, createBranch: false });
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
