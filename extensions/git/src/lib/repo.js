import * as forge from "@/lib/forge";
import { run, runOutput, tryRun } from "@/lib/forge/exec";

const PENDING_OP_PROBE = [
    `[ -f "$(git rev-parse --git-path rebase-merge/head-name)" ] || [ -f "$(git rev-parse --git-path rebase-apply/head-name)" ] && { printf %s rebase; exit; }`,
    ...[
        ["REVERT_HEAD", "revert"],
        ["CHERRY_PICK_HEAD", "cherry-pick"],
        ["MERGE_HEAD", "merge"],
    ].map(([ref, op]) => `git rev-parse --verify --quiet ${ref} >/dev/null 2>&1 && { printf %s ${op}; exit; }`),
].join("; ");

function samePath(a, b) {
    return (a || "").replace(/\/+$/, "") === (b || "").replace(/\/+$/, "");
}

export function repoInfo() {
    return muxy.git.repoInfo();
}

async function pendingOp() {
    const res = await muxy.exec({ shell: PENDING_OP_PROBE }).catch(() => null);
    return res?.stdout?.trim() || null;
}

function toFile(file) {
    const letter = String(file.status ?? "").trim().charAt(0).toUpperCase();
    return {
        path: file.path,
        status: file.status === "?" ? "?" : letter || "M",
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
    };
}

async function isUnbornRepo() {
    const inside = await muxy.exec(["git", "rev-parse", "--is-inside-work-tree"]).catch(() => null);
    if (inside?.exitCode !== 0 || inside.stdout.trim() !== "true")
        return false;
    const head = await muxy.exec(["git", "rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => null);
    return head?.exitCode !== 0;
}

async function unbornSnapshot() {
    const [branch, entries] = await Promise.all([
        tryRun(["git", "branch", "--show-current"]),
        tryRun(["git", "status", "--porcelain=1", "-z", "--untracked-files=all"]),
    ]);
    const stagedFiles = [];
    const unstagedFiles = [];
    for (const entry of entries.split("\0")) {
        if (entry.length < 4)
            continue;
        const path = entry.slice(3);
        const staged = entry.charAt(0);
        const unstaged = entry.charAt(1);
        if (staged !== " " && staged !== "?")
            stagedFiles.push({ path, status: staged });
        if (unstaged !== " ")
            unstagedFiles.push({ path, status: unstaged });
    }
    return {
        branch: branch.trim(),
        defaultBranch: null,
        aheadBehind: { ahead: 0, behind: 0 },
        stagedFiles,
        unstagedFiles,
    };
}

async function localSnapshot(fresh) {
    try {
        return await muxy.git.status({ local: true, fresh });
    }
    catch (err) {
        if (await isUnbornRepo())
            return unbornSnapshot();
        throw err;
    }
}

export async function status({ fresh } = {}) {
    const [snapshot, op] = await Promise.all([
        localSnapshot(!!fresh),
        pendingOp(),
    ]);
    return {
        branch: snapshot.branch || null,
        defaultBranch: snapshot.defaultBranch ?? undefined,
        aheadBehind: { ahead: snapshot.aheadBehind.ahead, behind: snapshot.aheadBehind.behind },
        stagedFiles: snapshot.stagedFiles.map(toFile),
        unstagedFiles: snapshot.unstagedFiles.map(toFile),
        pullRequest: null,
        pendingOp: op,
    };
}

export function log({ maxCount, skip, fresh } = {}) {
    return muxy.git.log({ maxCount, skip, fresh: !!fresh });
}

export async function branches() {
    const [list, current] = await Promise.all([
        muxy.git.branches(),
        muxy.git.currentBranch().catch(() => null),
    ]);
    return { current: current || null, branches: list };
}

async function untrackedDiff() {
    const out = await tryRun(["git", "ls-files", "--others", "--exclude-standard", "-z"]);
    const paths = out.split("\0").filter(Boolean);
    if (paths.length === 0)
        return "";
    const diffs = await Promise.all(paths.map((path) => runOutput(["git", "diff", "--no-color", "--no-index", "--", "/dev/null", path])));
    return diffs.filter((d) => d.trim()).join("\n");
}

export async function diff({ staged } = {}) {
    const { diff: patch } = await muxy.git.diff({ raw: true, staged: !!staged });
    if (staged)
        return { diff: patch ?? "" };
    const untracked = await untrackedDiff();
    if (!untracked)
        return { diff: patch ?? "" };
    return { diff: patch?.trim() ? `${patch}\n${untracked}` : untracked };
}

export async function commitDiff(hash) {
    return { diff: await run(["git", "show", "--format=", "--no-color", hash]) };
}

export async function incomingDiff(ref) {
    return { diff: await run(["git", "diff", "--no-color", `HEAD...${ref}`]) };
}

export function stage(paths) {
    return muxy.git.stage({ paths: paths ?? [] });
}

export function unstage(paths) {
    return muxy.git.unstage({ paths: paths ?? [] });
}

export function discard({ paths, untrackedPaths } = {}) {
    return muxy.git.discard({ paths: paths ?? [], untrackedPaths: untrackedPaths ?? [] });
}

export function commit({ message, stageAll } = {}) {
    return muxy.git.commit({ message, stageAll: !!stageAll });
}

async function pushPrBranch() {
    const branch = (await tryRun(["git", "branch", "--show-current"])).trim();
    if (!branch)
        return false;
    const prNumber = (await tryRun(["git", "config", "--get", `branch.${branch}.muxy-pr-number`])).trim();
    if (!prNumber)
        return false;
    const upstream = (await tryRun(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])).trim();
    const separator = upstream.indexOf("/");
    if (separator <= 0)
        return false;
    const remote = upstream.slice(0, separator);
    const remoteBranch = upstream.slice(separator + 1);
    if (!remote || !remoteBranch)
        return false;
    await run(["git", "push", remote, `HEAD:refs/heads/${remoteBranch}`]);
    return true;
}

export async function push({ setUpstream } = {}) {
    if (setUpstream)
        return muxy.git.push({ setUpstream: true });
    if (await pushPrBranch())
        return;
    return muxy.git.push();
}

export function fetch() {
    return run(["git", "fetch"]);
}

export async function upstreamDivergence() {
    const { ahead, behind, hasUpstream } = await muxy.git.aheadBehind({ fresh: true });
    return hasUpstream ? { ahead, behind } : null;
}

export function reconcile(mode) {
    if (mode === "rebase")
        return run(["git", "rebase", "@{upstream}"]);
    if (mode === "merge")
        return run(["git", "merge", "@{upstream}"]);
    return run(["git", "merge", "--ff-only", "@{upstream}"]);
}

export async function pullFastForward() {
    await fetch();
    await reconcile("ff");
}

export function abortOperation(op) {
    return run(["git", op, "--abort"]);
}

export function cherryPick(hash) {
    return muxy.git.cherryPick({ hash });
}

export function revert(hash) {
    return muxy.git.revert({ hash });
}

export function init() {
    return muxy.git.init();
}

export function branchCreate(name) {
    return muxy.git.branch.create({ name });
}

export function branchSwitch(branch) {
    return muxy.git.branch.switchTo({ branch });
}

export function branchDelete(name, force) {
    return muxy.git.branch.delete({ name, force: !!force });
}

export function branchDeleteRemote(branch) {
    return muxy.git.branch.deleteRemote({ branch });
}

export async function remoteUrl() {
    return (await tryRun(["git", "remote", "get-url", "origin"])).trim();
}

export async function worktreesList() {
    const [list, info] = await Promise.all([
        muxy.git.worktrees(),
        repoInfo().catch(() => null),
    ]);
    return list.map((entry, index) => ({
        path: entry.path,
        id: entry.path,
        isPrimary: index === 0,
        isActive: samePath(entry.path, info?.root),
        branch: entry.branch ?? undefined,
    }));
}

export const prList = (opts) => forge.prList(opts);
export const prInfo = () => forge.prInfo();
export const prCreate = (opts) => forge.prCreate(opts);
export const prMerge = (opts) => forge.prMerge(opts);
export const prClose = (number) => forge.prClose(number);
export const prReady = (opts) => forge.prReady(opts);
export const prCheckout = (number) => forge.prCheckout(number);
export const prCheckoutWorktree = (number, path) => forge.prCheckoutWorktree(number, path);
export const prDiff = (number) => forge.prDiff(number);
export const runList = (opts) => forge.runList(opts);
export const runRerun = (id, opts) => forge.runRerun(id, opts);
export const runCancel = (id) => forge.runCancel(id);
