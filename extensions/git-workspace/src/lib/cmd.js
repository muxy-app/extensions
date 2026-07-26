import * as forge from "@/lib/forge";

const FS = "\x1f";
const RS = "\x1e";

function samePath(a, b) {
    return (a || "").replace(/\/+$/, "") === (b || "").replace(/\/+$/, "");
}

export async function run(argv, cwd) {
    const res = await muxy.exec(argv, { cwd });
    if (res.exitCode !== 0)
        throw new Error(res.stderr || res.stdout || `Command failed: ${argv.join(" ")}`);
    return res.stdout;
}

async function tryRun(argv, cwd) {
    try {
        return await run(argv, cwd);
    }
    catch {
        return "";
    }
}

export async function repoInfo(cwd) {
    const root = (await tryRun(["git", "rev-parse", "--show-toplevel"], cwd)).trim();
    const gitDir = (await tryRun(["git", "rev-parse", "--git-dir"], cwd)).trim();
    const currentBranch = (await tryRun(["git", "branch", "--show-current"], cwd)).trim();
    return {
        root,
        isWorktree: gitDir.includes("/worktrees/"),
        currentBranch,
    };
}

async function defaultBranch(cwd) {
    const ref = (await tryRun(["git", "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], cwd)).trim();
    if (ref)
        return ref.replace(/^refs\/remotes\/origin\//, "");
    return "main";
}

function parseNumstat(text) {
    const map = new Map();
    for (const line of text.split("\n")) {
        if (!line.trim())
            continue;
        const parts = line.split("\t");
        if (parts.length < 3)
            continue;
        const [add, del, ...rest] = parts;
        const path = rest.join("\t");
        map.set(path, {
            additions: add === "-" ? 0 : Number(add) || 0,
            deletions: del === "-" ? 0 : Number(del) || 0,
        });
    }
    return map;
}

function statusLetter(xy) {
    const letter = (xy || "").trim().charAt(0).toUpperCase();
    return letter || "M";
}

function fileFromNumstat(map, path) {
    const n = map.get(path) || { additions: 0, deletions: 0 };
    return { additions: n.additions, deletions: n.deletions };
}

function parsePorcelain(text) {
    const lines = text.split("\n");
    const result = { branch: null, ahead: 0, behind: 0, staged: [], unstaged: [] };
    for (const line of lines) {
        if (!line)
            continue;
        if (line.startsWith("# branch.head ")) {
            const head = line.slice("# branch.head ".length).trim();
            result.branch = head === "(detached)" ? null : head;
            continue;
        }
        if (line.startsWith("# branch.ab ")) {
            const m = line.match(/\+(-?\d+)\s+-(-?\d+)/);
            if (m) {
                result.ahead = Number(m[1]) || 0;
                result.behind = Number(m[2]) || 0;
            }
            continue;
        }
        if (line.startsWith("1 ") || line.startsWith("2 ")) {
            const parts = line.split(" ");
            const xy = parts[1];
            const isRename = line.startsWith("2 ");
            const path = isRename
                ? line.split("\t")[0].split(" ").slice(8).join(" ")
                : parts.slice(8).join(" ");
            const stagedCode = xy.charAt(0);
            const unstagedCode = xy.charAt(1);
            if (stagedCode !== ".")
                result.staged.push({ path, code: stagedCode });
            if (unstagedCode !== ".")
                result.unstaged.push({ path, code: unstagedCode });
            continue;
        }
        if (line.startsWith("? ")) {
            const path = line.slice(2);
            result.unstaged.push({ path, code: "?" });
        }
    }
    return result;
}

const PENDING_OP_PROBE = [
    `[ -f "$(git rev-parse --git-path rebase-merge/head-name)" ] || [ -f "$(git rev-parse --git-path rebase-apply/head-name)" ] && { printf %s rebase; exit; }`,
    ...[
        ["REVERT_HEAD", "revert"],
        ["CHERRY_PICK_HEAD", "cherry-pick"],
        ["MERGE_HEAD", "merge"],
    ].map(([ref, op]) => `git rev-parse --verify --quiet ${ref} >/dev/null 2>&1 && { printf %s ${op}; exit; }`),
]
    .join("; ");

async function pendingOp(cwd) {
    const res = await muxy.exec({ shell: PENDING_OP_PROBE }, { cwd }).catch(() => null);
    return res?.stdout?.trim() || null;
}

async function untrackedNumstat(paths, cwd) {
    const map = new Map();
    const stats = await Promise.all(paths.map(async (path) => {
        const res = await muxy.exec(["git", "diff", "--numstat", "--no-index", "--", "/dev/null", path], { cwd }).catch(() => null);
        const [stat] = parseNumstat(res?.stdout ?? "").values();
        return [path, stat];
    }));
    for (const [path, stat] of stats) {
        if (stat)
            map.set(path, stat);
    }
    return map;
}

export function abortOperation(cwd, op) {
    return run(["git", op, "--abort"], cwd);
}

export async function status(cwd) {
    const [porcelainText, unstagedStat, stagedStat, def, op] = await Promise.all([
        tryRun(["git", "status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"], cwd).then((z) => z.replace(/\0/g, "\n")),
        tryRun(["git", "diff", "--numstat"], cwd),
        tryRun(["git", "diff", "--cached", "--numstat"], cwd),
        defaultBranch(cwd),
        pendingOp(cwd),
    ]);
    const parsed = parsePorcelain(porcelainText);
    const unstagedMap = parseNumstat(unstagedStat);
    const stagedMap = parseNumstat(stagedStat);
    const untrackedPaths = parsed.unstaged.filter((f) => f.code === "?").map((f) => f.path);
    if (untrackedPaths.length > 0) {
        for (const [path, stat] of await untrackedNumstat(untrackedPaths, cwd))
            unstagedMap.set(path, stat);
    }
    const stagedFiles = parsed.staged.map((f) => ({
        path: f.path,
        status: statusLetter(f.code),
        ...fileFromNumstat(stagedMap, f.path),
    }));
    const unstagedFiles = parsed.unstaged.map((f) => ({
        path: f.path,
        status: f.code === "?" ? "?" : statusLetter(f.code),
        ...fileFromNumstat(unstagedMap, f.path),
    }));
    return {
        branch: parsed.branch,
        defaultBranch: def,
        aheadBehind: { ahead: parsed.ahead, behind: parsed.behind },
        stagedFiles,
        unstagedFiles,
        pullRequest: null,
        pendingOp: op,
    };
}

function parseRefs(decoration) {
    if (!decoration.trim())
        return [];
    return decoration
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => d.replace(/^HEAD -> /, "HEAD,").split(","))
        .flat()
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
            if (d === "HEAD")
                return { name: "HEAD", kind: "head" };
            if (d.startsWith("tag: "))
                return { name: d.slice(5), kind: "tag" };
            if (d.startsWith("origin/"))
                return { name: d, kind: "remote" };
            return { name: d, kind: "branch" };
        });
}

export async function log(cwd, { maxCount, skip } = {}) {
    const format = ["%H", "%h", "%s", "%an", "%aI", "%P", "%D"].join(FS) + RS;
    const argv = ["git", "log", `--pretty=format:${format}`];
    if (maxCount)
        argv.push("-n", String(maxCount));
    if (skip)
        argv.push("--skip", String(skip));
    const out = await tryRun(argv, cwd);
    return out
        .split(RS)
        .map((rec) => rec.replace(/^\n/, ""))
        .filter((rec) => rec.trim())
        .map((rec) => {
            const [hash, shortHash, subject, authorName, authorDate, parents, refs] = rec.split(FS);
            const parentHashes = parents.trim() ? parents.trim().split(/\s+/) : [];
            return {
                hash,
                shortHash,
                subject,
                authorName,
                authorDate,
                isMerge: parentHashes.length > 1,
                parentHashes,
                refs: parseRefs(refs || ""),
            };
        });
}

export async function branches(cwd) {
    const out = await tryRun(["git", "branch", "--format=%(refname:short)%00%(HEAD)"], cwd);
    let current = null;
    const list = [];
    for (const line of out.split("\n")) {
        if (!line.trim())
            continue;
        const [name, head] = line.split("\0");
        if (!name)
            continue;
        list.push(name);
        if (head === "*")
            current = name;
    }
    return { current, branches: list };
}

async function diffNoIndex(path, cwd) {
    const res = await muxy.exec(["git", "diff", "--no-color", "--no-index", "--", "/dev/null", path], { cwd }).catch(() => null);
    return res?.stdout ?? "";
}

async function untrackedDiff(cwd) {
    const out = await tryRun(["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd);
    const paths = out.split("\0").filter(Boolean);
    if (paths.length === 0)
        return "";
    const diffs = await Promise.all(paths.map((path) => diffNoIndex(path, cwd)));
    return diffs.filter((d) => d.trim()).join("\n");
}

export async function diff(cwd, { staged, lineLimit } = {}) {
    const argv = ["git", "diff", "--no-color"];
    if (staged)
        argv.push("--cached");
    let out = await tryRun(argv, cwd);
    if (!staged) {
        const untracked = await untrackedDiff(cwd);
        if (untracked)
            out = out.trim() ? `${out}\n${untracked}` : untracked;
    }
    if (lineLimit && out) {
        const lines = out.split("\n");
        if (lines.length > lineLimit)
            out = lines.slice(0, lineLimit).join("\n");
    }
    return { diff: out };
}

export async function commitDiff(cwd, hash) {
    const out = await run(["git", "show", "--format=", "--no-color", hash], cwd);
    return { diff: out };
}

export function stage(cwd, paths) {
    if (!paths || paths.length === 0)
        return run(["git", "add", "-A"], cwd);
    return run(["git", "add", "--", ...paths], cwd);
}

export function unstage(cwd, paths) {
    if (!paths || paths.length === 0)
        return run(["git", "reset"], cwd);
    return run(["git", "restore", "--staged", "--", ...paths], cwd);
}

export async function discard(cwd, { paths, untrackedPaths } = {}) {
    if (paths && paths.length > 0)
        await run(["git", "checkout", "--", ...paths], cwd);
    if (untrackedPaths)
        for (const path of untrackedPaths)
            await run(["rm", "-f", path], cwd);
}

export async function commit(cwd, { message, stageAll } = {}) {
    if (stageAll)
        await run(["git", "add", "-A"], cwd);
    return run(["git", "commit", "-m", message], cwd);
}

async function pushPrBranch(cwd) {
    const branch = (await tryRun(["git", "branch", "--show-current"], cwd)).trim();
    if (!branch)
        return false;
    const prNumber = (await tryRun(["git", "config", "--get", `branch.${branch}.muxy-pr-number`], cwd)).trim();
    if (!prNumber)
        return false;
    const upstream = (await tryRun(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd)).trim();
    const separator = upstream.indexOf("/");
    if (separator <= 0)
        return false;
    const remote = upstream.slice(0, separator);
    const remoteBranch = upstream.slice(separator + 1);
    if (!remote || !remoteBranch)
        return false;
    await run(["git", "push", remote, `HEAD:refs/heads/${remoteBranch}`], cwd);
    return true;
}

async function hasUpstream(cwd) {
    const res = await muxy.exec(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { cwd });
    return res.exitCode === 0;
}

export async function push(cwd, { setUpstream } = {}) {
    if (setUpstream)
        return run(["git", "push", "-u", "origin", "HEAD"], cwd);
    if (await pushPrBranch(cwd))
        return "";
    if (!(await hasUpstream(cwd)))
        return run(["git", "push", "-u", "origin", "HEAD"], cwd);
    return run(["git", "push"], cwd);
}

export function pull(cwd) {
    return run(["git", "pull", "--ff-only"], cwd);
}

export function fetch(cwd) {
    return run(["git", "fetch"], cwd);
}

export async function upstreamDivergence(cwd) {
    const upstream = await muxy.exec(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { cwd });
    if (upstream.exitCode !== 0)
        return null;
    const out = await run(["git", "rev-list", "--left-right", "--count", "@{upstream}...HEAD"], cwd);
    const match = out.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match)
        throw new Error(`Unexpected rev-list output: ${out.trim()}`);
    return { behind: Number(match[1]), ahead: Number(match[2]) };
}

export function reconcile(cwd, mode) {
    if (mode === "rebase")
        return run(["git", "rebase", "@{upstream}"], cwd);
    if (mode === "merge")
        return run(["git", "merge", "@{upstream}"], cwd);
    return run(["git", "merge", "--ff-only", "@{upstream}"], cwd);
}

export function cherryPick(cwd, hash) {
    return run(["git", "cherry-pick", hash], cwd);
}

export function revert(cwd, hash) {
    return run(["git", "revert", "--no-commit", hash], cwd);
}

export function init(cwd) {
    return run(["git", "init"], cwd);
}

export function branchCreate(cwd, name) {
    return run(["git", "switch", "-c", name], cwd);
}

export function branchSwitch(cwd, branch) {
    return run(["git", "switch", branch], cwd);
}

export function branchDelete(cwd, name, force) {
    return run(["git", "branch", force ? "-D" : "-d", name], cwd);
}

export function branchDeleteRemote(cwd, branch) {
    return run(["git", "push", "origin", "--delete", branch], cwd);
}

export async function remoteUrl(cwd) {
    return (await tryRun(["git", "remote", "get-url", "origin"], cwd)).trim();
}

export async function worktreesList(cwd) {
    const out = await tryRun(["git", "worktree", "list", "--porcelain"], cwd);
    const entries = [];
    let current = null;
    for (const line of out.split("\n")) {
        if (line.startsWith("worktree ")) {
            if (current)
                entries.push(current);
            current = { path: line.slice("worktree ".length), branch: undefined };
        }
        else if (line.startsWith("branch ") && current) {
            current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
        }
    }
    if (current)
        entries.push(current);
    return entries.map((e, i) => ({
        path: e.path,
        id: e.path,
        isPrimary: i === 0,
        isActive: samePath(e.path, cwd),
        branch: e.branch,
    }));
}

export const prList = (cwd, opts) => forge.prList(cwd, opts);
export const prInfo = (cwd) => forge.prInfo(cwd);
export const statusPr = prInfo;
export const prCreate = (cwd, opts) => forge.prCreate(cwd, opts);
export const prMerge = (cwd, opts) => forge.prMerge(cwd, opts);
export const prClose = (cwd, number) => forge.prClose(cwd, number);
export const prReady = (cwd, opts) => forge.prReady(cwd, opts);
export const prCheckout = (cwd, number) => forge.prCheckout(cwd, number);
export const prepareWorktreeBranch = (cwd, number) => forge.prepareWorktreeBranch(cwd, number);
export const prDiff = (cwd, number) => forge.prDiff(cwd, number);
export const runList = (cwd, opts) => forge.runList(cwd, opts);
export const runRerun = (cwd, id, opts) => forge.runRerun(cwd, id, opts);
export const runCancel = (cwd, id) => forge.runCancel(cwd, id);
