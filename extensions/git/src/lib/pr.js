import { activeGitProjectPath, activeWorktreePath, alertError, confirmAction, errorMessage, openUrl } from "@/lib/git";
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
export function mergePr(number, method, deleteBranch, project) {
    return muxy.git.pr.merge({ number, method, deleteBranch, project });
}
export function closePr(number, project) {
    return muxy.git.pr.close({ number, project });
}
export function createPr(title, body, baseBranch, draft, project) {
    return muxy.git.pr.create({ title, body, baseBranch, draft, project });
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
async function pullQuietly(project) {
    await muxy.git.pull({ project }).catch(() => undefined);
}
async function activeWorktree(project) {
    const worktrees = await muxy.worktrees.list(project).catch(() => []);
    const active = worktrees.find((w) => w.isActive);
    if (active)
        return active;
    const info = await muxy.git.repoInfo({ project }).catch(() => null);
    const toplevel = info?.root;
    return ((toplevel ? worktrees.find((w) => w.path === toplevel) : undefined) ??
        worktrees.find((w) => w.isPrimary));
}
async function isOnWorktree(project) {
    const info = await muxy.git.repoInfo({ project }).catch(() => null);
    if (info)
        return info.isWorktree;
    const active = await activeWorktree(project);
    return !!active && !active.isPrimary;
}
async function removeActiveWorktree(branch, force, project) {
    const worktrees = await muxy.worktrees.list(project).catch(() => []);
    const active = await activeWorktree(project);
    if (!active || active.isPrimary)
        throw new Error("No active worktree to remove.");
    const replacement = worktrees.find((w) => w.isPrimary && w.id !== active.id) ??
        worktrees.find((w) => w.id !== active.id);
    if (replacement) {
        await muxy.git.worktree
            .switchTo({ project, identifier: replacement.path })
            .catch(() => muxy.worktrees.switchTo(replacement.path, project));
    }
    await muxy.git.worktree.remove({ project, path: active.path, force });
    if (branch)
        await muxy.git.branch.deleteRemote({ project, branch }).catch(() => undefined);
    if (replacement)
        await pullQuietly(project);
    await muxy.worktrees.refresh(project);
}
export async function removeWorktreeOrBranch({ branch, defaultBranch, dirty }, project) {
    project ??= await activeGitProjectPath();
    if (await isOnWorktree(project)) {
        await removeActiveWorktree(branch, dirty, project);
        return;
    }
    if (!branch)
        throw new Error("No branch to clean up.");
    if (branch === defaultBranch) {
        throw new Error(`"${branch}" is the default branch and won't be deleted.`);
    }
    const target = defaultBranch ?? "main";
    await muxy.git.branch.switchTo({ project, branch: target });
    const { currentBranch } = await muxy.git.repoInfo({ project });
    if (currentBranch === branch) {
        throw new Error(`Still on "${branch}" after switching to ${target}.`);
    }
    await muxy.git.branch.delete({ project, name: branch, force: true });
    await muxy.git.branch.deleteRemote({ project, branch }).catch(() => undefined);
    await pullQuietly(project);
    await muxy.worktrees.refresh(project);
}
export async function cleanupBranch(target, project) {
    if (!target.branch)
        return false;
    try {
        await removeWorktreeOrBranch(target, project);
        return true;
    }
    catch (err) {
        await alertError("Cleanup failed", err);
        return false;
    }
}
export function checkoutPr(number, project) {
    return muxy.git.pr.checkout({ number, project });
}
export async function suggestWorktreePath(number) {
    const base = await activeWorktreePath();
    const parent = base ? base.replace(/\/+$/, "").replace(/\/[^/]+$/, "") : "";
    const name = `pr-${number}`;
    return parent ? `${parent}/${name}` : name;
}
export async function checkoutPrWorktree(number, project) {
    const suggested = await suggestWorktreePath(number);
    const path = await promptPath(number, suggested);
    if (!path)
        return null;
    const { branch } = await muxy.git.pr.checkoutWorktree({ number, path, project });
    await muxy.worktrees.refresh().catch(() => undefined);
    await muxy.git.worktree.switchTo({ identifier: path }).catch(() => undefined);
    return branch;
}
async function promptPath(number, suggested) {
    const res = await muxy
        .exec({
        shell: `osascript -e 'set r to text returned of (display dialog "Worktree path for PR #${number}" default answer "${suggested}" with title "Checkout to Worktree")' 2>/dev/null`,
    })
        .catch(() => null);
    if (!res || res.exitCode !== 0)
        return null;
    const path = res.stdout.trim();
    return path || null;
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
