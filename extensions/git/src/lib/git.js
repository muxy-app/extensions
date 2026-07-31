import * as repo from "@/lib/repo";

let scopePromise = null;
let scopeValue;
let scopeResolved = false;

let busyDepth = 0;
const busyListeners = new Set();

function invalidateScope() {
    scopeResolved = false;
    scopePromise = null;
    scopeValue = undefined;
}

muxy.events.subscribe("project.switched", invalidateScope);
muxy.events.subscribe("worktree.switched", invalidateScope);

export async function repoScope() {
    if (scopeResolved)
        return scopeValue;
    if (!scopePromise) {
        scopePromise = repo
            .repoInfo()
            .then((info) => info?.root)
            .catch(() => undefined)
            .then((value) => {
            scopeValue = value;
            scopeResolved = true;
            scopePromise = null;
            return value;
        });
    }
    return scopePromise;
}

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

export async function runBusy(fn) {
    setBusyDepth(busyDepth + 1);
    try {
        return await fn();
    }
    finally {
        setBusyDepth(busyDepth - 1);
    }
}

function openDiffTab(data) {
    try {
        void muxy.tabs.open({
            kind: "extensionWebView",
            extension: {
                id: muxy.extensionID,
                tabType: "diff-viewer",
                singleton: true,
                data,
            },
        });
    }
    catch {
        return;
    }
}

export function openDiff(focusPath) {
    openDiffTab({ focusPath });
}

export function openCommitDiff(hash, shortHash) {
    openDiffTab({ source: "commit", hash, shortHash });
}

export function openPrDiff(prNumber) {
    openDiffTab({ source: "pr", prNumber });
}

export function openIncomingDiff() {
    openDiffTab({ source: "incoming" });
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

export function listBranches() {
    return repo.branches();
}

export async function hasPendingChanges() {
    const s = await repo.status().catch(() => null);
    if (!s)
        return false;
    return s.stagedFiles.length > 0 || s.unstagedFiles.length > 0;
}

export function commitAll(message) {
    return tryAction(() => repo.commit({ message, stageAll: true }), "Could not commit changes");
}
