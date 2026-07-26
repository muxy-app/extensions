import * as cmd from "@/lib/cmd";

let pinnedCwd;
let pinnedDepth = 0;
let invalidationPending = false;

let resolvedCwd = false;
let cachedCwd;
let inflightCwd = null;

let busyDepth = 0;
const busyListeners = new Set();

function normalizePath(path) {
    return path.replace(/\/+$/, "");
}

export function samePath(a, b) {
    return normalizePath(a) === normalizePath(b);
}

async function resolveActiveWorktreePath() {
    try {
        const worktrees = await muxy.worktrees.list();
        const active = worktrees.find((w) => w.isActive) ?? worktrees.find((w) => w.isPrimary);
        return active?.path ?? worktrees[0]?.path;
    }
    catch {
        return undefined;
    }
}

function invalidateCwd() {
    if (pinnedDepth > 0) {
        invalidationPending = true;
        return;
    }
    resolvedCwd = false;
    inflightCwd = null;
    cachedCwd = undefined;
}

muxy.events.subscribe("project.switched", invalidateCwd);
muxy.events.subscribe("worktree.switched", invalidateCwd);

export async function activeWorktreePath() {
    if (pinnedDepth > 0)
        return pinnedCwd;
    if (resolvedCwd)
        return cachedCwd;
    if (!inflightCwd) {
        inflightCwd = resolveActiveWorktreePath().then((value) => {
            cachedCwd = value;
            resolvedCwd = true;
            inflightCwd = null;
            return value;
        });
    }
    return inflightCwd;
}

export const activeProject = activeWorktreePath;
export const activeGitProjectPath = activeWorktreePath;

export function isBusy() {
    return busyDepth > 0;
}

export function onBusyChange(fn) {
    busyListeners.add(fn);
    return () => busyListeners.delete(fn);
}

function setBusyDepth(next) {
    const was = busyDepth > 0;
    busyDepth = next;
    const now = busyDepth > 0;
    if (was !== now)
        for (const fn of busyListeners)
            fn(now);
}

export async function runPinned(fn) {
    const cwd = await activeWorktreePath();
    if (pinnedDepth === 0)
        pinnedCwd = cwd;
    pinnedDepth += 1;
    setBusyDepth(busyDepth + 1);
    try {
        return await fn(pinnedCwd);
    }
    finally {
        pinnedDepth -= 1;
        if (pinnedDepth === 0) {
            pinnedCwd = undefined;
            if (invalidationPending) {
                invalidationPending = false;
                invalidateCwd();
            }
        }
        setBusyDepth(busyDepth - 1);
    }
}

export async function openDiff(focusPath) {
    try {
        const cwd = await activeWorktreePath();
        void muxy.tabs.open({
            kind: "extensionWebView",
            extension: {
                id: muxy.extensionID,
                tabType: "diff-viewer",
                singleton: true,
                data: { focusPath, cwd },
            },
        });
    }
    catch {
        return;
    }
}

export async function openCommitDiff(hash, shortHash) {
    try {
        const cwd = await activeWorktreePath();
        void muxy.tabs.open({
            kind: "extensionWebView",
            extension: {
                id: muxy.extensionID,
                tabType: "diff-viewer",
                singleton: true,
                data: { source: "commit", hash, shortHash, cwd },
            },
        });
    }
    catch {
        return;
    }
}

export async function openPrDiff(prNumber) {
    try {
        const cwd = await activeWorktreePath();
        void muxy.tabs.open({
            kind: "extensionWebView",
            extension: {
                id: muxy.extensionID,
                tabType: "diff-viewer",
                singleton: true,
                data: { source: "pr", prNumber, cwd },
            },
        });
    }
    catch {
        return;
    }
}

export async function openIncomingDiff() {
    try {
        const cwd = await activeWorktreePath();
        void muxy.tabs.open({
            kind: "extensionWebView",
            extension: {
                id: muxy.extensionID,
                tabType: "diff-viewer",
                singleton: true,
                data: { source: "incoming", cwd },
            },
        });
    }
    catch {
        return;
    }
}

export function openUrl(url) {
    if (!url)
        return;
    void muxy.exec(["open", url]).catch(() => undefined);
}

export function errorMessage(err) {
    if (err instanceof Error)
        return err.message;
    const text = String(err).trim();
    return text || "Unknown error";
}

export async function confirmAction(opts) {
    try {
        const choice = await muxy.dialog.confirm({
            title: opts.title,
            message: opts.message,
            buttons: [opts.confirmLabel, "Cancel"],
            default: "Cancel",
            cancel: "Cancel",
            style: opts.critical ? "critical" : "warning",
        });
        return choice === opts.confirmLabel;
    }
    catch {
        return false;
    }
}

export async function alertError(title, err) {
    try {
        await muxy.dialog.alert({ title, message: errorMessage(err), style: "critical" });
    }
    catch {
        return;
    }
}

export async function tryAction(action, errorTitle) {
    try {
        await action();
        return true;
    }
    catch (err) {
        await alertError(errorTitle, err);
        return false;
    }
}

export function toViewStatus(s) {
    return {
        branch: s.branch || null,
        defaultBranch: s.defaultBranch,
        ahead: s.aheadBehind.ahead,
        behind: s.aheadBehind.behind,
        staged: s.stagedFiles.map(toEntry),
        unstaged: s.unstagedFiles.map(toEntry),
        pullRequest: s.pullRequest,
        pendingOp: s.pendingOp ?? null,
    };
}

function toEntry(f) {
    return {
        path: f.path,
        label: normalizeLabel(f.status),
        added: f.additions,
        removed: f.deletions,
    };
}

function normalizeLabel(status) {
    const letter = status.trim().charAt(0).toUpperCase();
    return letter || "M";
}

export async function listBranches() {
    const cwd = await activeWorktreePath();
    return cmd.branches(cwd);
}

export async function hasPendingChanges(cwd) {
    const s = await cmd.status(cwd).catch(() => null);
    if (!s)
        return false;
    return s.stagedFiles.length > 0 || s.unstagedFiles.length > 0;
}

export function commitAll(message, cwd) {
    return tryAction(() => cmd.commit(cwd, { message, stageAll: true }), "Could not commit changes");
}
