import { run, tryRun } from "@/lib/forge/exec";

const PR_FIELDS = "number,title,author,headRefName,baseRefName,state,url,isDraft,mergeable,mergeStateStatus,statusCheckRollup";

function aggregateChecks(statusCheckRollup) {
    const rollup = Array.isArray(statusCheckRollup) ? statusCheckRollup : [];
    let passing = 0;
    let failing = 0;
    let pending = 0;
    for (const check of rollup) {
        const status = String(check.status || "").toUpperCase();
        const outcome = String(check.conclusion || check.state || "").toUpperCase();
        if (status && status !== "COMPLETED")
            pending += 1;
        else if (outcome === "SUCCESS" || outcome === "NEUTRAL" || outcome === "SKIPPED")
            passing += 1;
        else if (outcome === "FAILURE" || outcome === "ERROR" || outcome === "TIMED_OUT" || outcome === "CANCELLED" || outcome === "ACTION_REQUIRED")
            failing += 1;
        else if (outcome === "PENDING" || outcome === "EXPECTED")
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
    if (filter === "merged")
        return "merged";
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

export function prReady(cwd, { number } = {}) {
    return run(["gh", "pr", "ready", String(number)], cwd);
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

const RUN_FIELDS = "databaseId,displayTitle,workflowName,status,conclusion,headBranch,event,url,createdAt";

function toRun(raw) {
    return {
        id: raw.databaseId,
        title: raw.displayTitle || raw.workflowName || "",
        workflow: raw.workflowName || "",
        status: String(raw.status || "").toLowerCase(),
        conclusion: String(raw.conclusion || "").toLowerCase(),
        branch: raw.headBranch || "",
        event: raw.event || "",
        url: raw.url || "",
        createdAt: raw.createdAt || "",
    };
}

export async function runList(cwd, { limit } = {}) {
    const argv = ["gh", "run", "list", "--json", RUN_FIELDS];
    if (limit)
        argv.push("--limit", String(limit));
    const out = await run(argv, cwd);
    if (!out.trim())
        return [];
    return JSON.parse(out).map(toRun);
}

export function runRerun(cwd, id, { failedOnly } = {}) {
    const argv = ["gh", "run", "rerun", String(id)];
    if (failedOnly)
        argv.push("--failed");
    return run(argv, cwd);
}

export function runCancel(cwd, id) {
    return run(["gh", "run", "cancel", String(id)], cwd);
}
