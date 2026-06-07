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

export async function status(cwd) {
    const [porcelainText, unstagedStat, stagedStat, def] = await Promise.all([
        tryRun(["git", "status", "--porcelain=v2", "--branch", "-z"], cwd).then((z) => z.replace(/\0/g, "\n")),
        tryRun(["git", "diff", "--numstat"], cwd),
        tryRun(["git", "diff", "--cached", "--numstat"], cwd),
        defaultBranch(cwd),
    ]);
    const parsed = parsePorcelain(porcelainText);
    const unstagedMap = parseNumstat(unstagedStat);
    const stagedMap = parseNumstat(stagedStat);
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

export async function diff(cwd, { staged, lineLimit } = {}) {
    const argv = ["git", "diff", "--no-color"];
    if (staged)
        argv.push("--cached");
    let out = await tryRun(argv, cwd);
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

export async function push(cwd, { setUpstream } = {}) {
    if (setUpstream)
        return run(["git", "push", "-u", "origin", "HEAD"], cwd);
    if (await pushPrBranch(cwd))
        return "";
    return run(["git", "push"], cwd);
}

export function pull(cwd) {
    return run(["git", "pull"], cwd);
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

const PR_FIELDS = "number,title,author,headRefName,baseRefName,state,url,isDraft,mergeable,mergeStateStatus,statusCheckRollup";

export function aggregateChecks(statusCheckRollup) {
    const rollup = Array.isArray(statusCheckRollup) ? statusCheckRollup : [];
    let passing = 0;
    let failing = 0;
    let pending = 0;
    for (const check of rollup) {
        const state = String(check.state || check.status || check.conclusion || "").toUpperCase();
        if (state === "COMPLETEDSUCCESS" || state === "SUCCESS")
            passing += 1;
        else if (state === "FAILURE" || state === "ERROR")
            failing += 1;
        else if (state === "PENDING" || state === "IN_PROGRESS" || state === "QUEUED")
            pending += 1;
    }
    const total = rollup.length;
    let statusValue = "none";
    if (failing > 0)
        statusValue = "failure";
    else if (pending > 0)
        statusValue = "pending";
    else if (total > 0)
        statusValue = "success";
    return { status: statusValue, total, passing, failing, pending };
}

function mapMergeable(value) {
    if (value === "MERGEABLE")
        return true;
    if (value === "CONFLICTING")
        return false;
    return null;
}

function toPr(raw) {
    return {
        number: raw.number,
        title: raw.title,
        author: raw.author?.login ?? "",
        headBranch: raw.headRefName,
        baseBranch: raw.baseRefName,
        state: String(raw.state || "").toLowerCase(),
        url: raw.url,
        isDraft: !!raw.isDraft,
        mergeable: mapMergeable(raw.mergeable),
        mergeStateStatus: raw.mergeStateStatus || "",
        checks: aggregateChecks(raw.statusCheckRollup),
    };
}

function prStateFlag(filter) {
    if (filter === "closed")
        return "closed";
    if (filter === "all")
        return "all";
    return "open";
}

export async function prList(cwd, { filter, limit } = {}) {
    const argv = ["gh", "pr", "list", "--json", PR_FIELDS, "--state", prStateFlag(filter)];
    if (limit)
        argv.push("--limit", String(limit));
    const out = await tryRun(argv, cwd);
    if (!out.trim())
        return [];
    try {
        return JSON.parse(out).map(toPr);
    }
    catch {
        return [];
    }
}

async function prInfoFor(cwd, ref) {
    const res = await muxy.exec(["gh", "pr", "view", ...(ref ? [ref] : []), "--json", PR_FIELDS], { cwd });
    if (res.exitCode !== 0 || !res.stdout.trim())
        return null;
    return toPr(JSON.parse(res.stdout));
}

async function storedPrNumber(cwd) {
    const branch = (await tryRun(["git", "branch", "--show-current"], cwd)).trim();
    if (!branch)
        return null;
    const number = (await tryRun(["git", "config", "--get", `branch.${branch}.muxy-pr-number`], cwd)).trim();
    return number || null;
}

export async function prInfo(cwd) {
    try {
        const direct = await prInfoFor(cwd, null);
        if (direct)
            return direct;
        const number = await storedPrNumber(cwd);
        return number ? await prInfoFor(cwd, number) : null;
    }
    catch {
        return null;
    }
}

export const statusPr = prInfo;

export function prCreate(cwd, { title, body, baseBranch, draft } = {}) {
    const argv = ["gh", "pr", "create", "--title", title, "--body", body ?? ""];
    if (baseBranch)
        argv.push("--base", baseBranch);
    if (draft)
        argv.push("--draft");
    return run(argv, cwd);
}

export function prMerge(cwd, { number, method, deleteBranch } = {}) {
    const argv = ["gh", "pr", "merge", String(number)];
    if (method === "squash")
        argv.push("--squash");
    else if (method === "rebase")
        argv.push("--rebase");
    else
        argv.push("--merge");
    if (deleteBranch)
        argv.push("--delete-branch");
    return run(argv, cwd);
}

export function prClose(cwd, number) {
    return run(["gh", "pr", "close", String(number)], cwd);
}

function safeRefComponent(value) {
    const segments = String(value)
        .split("/")
        .map((segment) => segment.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""))
        .filter(Boolean);
    return segments.length ? segments.join("/") : "head";
}

function localPrBranchName(checkout) {
    return `pr/${checkout.number}/${safeRefComponent(checkout.headBranch)}`;
}

function prRemoteName(checkout) {
    return `pr-${checkout.number}-${safeRefComponent(checkout.headRepositoryNameWithOwner).replace(/\//g, "-")}`;
}

async function prCheckoutInfo(cwd, number) {
    const out = await run(["gh", "pr", "view", String(number), "--json", "number,headRefName,headRepository,headRepositoryOwner"], cwd);
    const raw = JSON.parse(out);
    const owner = raw.headRepositoryOwner?.login ?? "";
    const name = raw.headRepository?.name ?? "";
    return {
        number: raw.number,
        headBranch: raw.headRefName,
        headRepositoryNameWithOwner: owner && name ? `${owner}/${name}` : (raw.headRepository?.nameWithOwner ?? ""),
    };
}

async function remoteExists(cwd, remote) {
    const out = await tryRun(["git", "remote"], cwd);
    return out.split("\n").map((line) => line.trim()).includes(remote);
}

async function localBranchExists(cwd, branch) {
    const res = await muxy.exec(["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd });
    return res.exitCode === 0;
}

async function originOwner(cwd) {
    const url = (await tryRun(["git", "remote", "get-url", "origin"], cwd)).trim();
    const match = url.match(/[:/]([^/]+)\/[^/]+?(?:\.git)?$/);
    return match ? match[1].toLowerCase() : "";
}

async function ensurePrRemote(cwd, checkout) {
    const owner = checkout.headRepositoryNameWithOwner.split("/")[0]?.toLowerCase() ?? "";
    if (!owner || owner === (await originOwner(cwd)))
        return "origin";
    const remote = prRemoteName(checkout);
    if (!(await remoteExists(cwd, remote)))
        await run(["git", "remote", "add", remote, `https://github.com/${checkout.headRepositoryNameWithOwner}.git`], cwd);
    return remote;
}

async function preparePrBranch(cwd, checkout) {
    const remote = await ensurePrRemote(cwd, checkout);
    const branch = localPrBranchName(checkout);
    const startPoint = `refs/remotes/${remote}/${checkout.headBranch}`;
    await run(["git", "fetch", remote, `+refs/heads/${checkout.headBranch}:${startPoint}`], cwd);
    if (await localBranchExists(cwd, branch))
        await run(["git", "branch", `--set-upstream-to=${remote}/${checkout.headBranch}`, branch], cwd);
    else
        await run(["git", "branch", "--track", branch, startPoint], cwd);
    await run(["git", "config", `branch.${branch}.muxy-pr-number`, String(checkout.number)], cwd);
    return branch;
}

export async function prCheckout(cwd, number) {
    const checkout = await prCheckoutInfo(cwd, number);
    const branch = await preparePrBranch(cwd, checkout);
    await run(["git", "switch", branch], cwd);
    return { branch };
}

export async function prepareWorktreeBranch(cwd, number) {
    const checkout = await prCheckoutInfo(cwd, number);
    return preparePrBranch(cwd, checkout);
}

export async function prDiff(cwd, number) {
    const out = await run(["gh", "pr", "diff", String(number)], cwd);
    return { diff: out };
}
