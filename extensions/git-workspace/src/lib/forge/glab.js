import { run, tryRun } from "@/lib/forge/exec";

async function currentBranch(cwd) {
    return (await tryRun(["git", "branch", "--show-current"], cwd)).trim();
}

async function localBranchExists(cwd, branch) {
    const res = await muxy.exec(["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd });
    return res.exitCode === 0;
}

function mapState(value) {
    const s = String(value ?? "").toLowerCase();
    if (s === "opened")
        return "open";
    return s || "open";
}

function mapMergeable(raw) {
    const s = String(raw.merge_status ?? "").toLowerCase();
    if (s === "can_be_merged")
        return true;
    if (s === "cannot_be_merged")
        return false;
    return null;
}

function pipelineStatus(value) {
    const s = String(value ?? "").toLowerCase();
    if (!s)
        return "none";
    if (s === "failed" || s === "canceled" || s === "cancelled")
        return "failure";
    if (s === "success")
        return "success";
    if (s === "skipped" || s === "manual")
        return "none";
    return "pending";
}

function checksFromPipeline(pipeline) {
    const status = pipelineStatus(pipeline?.status);
    return {
        status,
        total: status === "none" ? 0 : 1,
        passing: status === "success" ? 1 : 0,
        failing: status === "failure" ? 1 : 0,
        pending: status === "pending" ? 1 : 0,
    };
}

function toPr(raw) {
    const state = mapState(raw.state);
    return {
        number: Number(raw.iid ?? raw.number) || 0,
        title: raw.title ?? "",
        author: raw.author?.username ?? "",
        headBranch: raw.source_branch ?? "",
        baseBranch: raw.target_branch ?? "",
        state,
        url: raw.web_url ?? "",
        isDraft: !!(raw.draft ?? raw.work_in_progress),
        mergeable: state === "open" ? mapMergeable(raw) : null,
        mergeStateStatus: raw.detailed_merge_status ?? "",
        checks: checksFromPipeline(raw.head_pipeline ?? raw.pipeline),
    };
}

export async function prList(cwd, { filter, limit } = {}) {
    const argv = ["glab", "mr", "list", "--output", "json"];
    if (filter === "merged")
        argv.push("--merged");
    else if (filter === "closed")
        argv.push("--closed");
    else if (filter === "all")
        argv.push("--all");
    if (limit)
        argv.push("--per-page", String(limit));
    const out = await tryRun(argv, cwd);
    if (!out.trim())
        return [];
    try {
        const data = JSON.parse(out);
        return (Array.isArray(data) ? data : []).map(toPr);
    }
    catch {
        return [];
    }
}

async function prInfoFor(cwd, ref) {
    const res = await muxy.exec(["glab", "mr", "view", ...(ref ? [String(ref)] : []), "--output", "json"], { cwd });
    if (res.exitCode !== 0 || !res.stdout.trim())
        return null;
    try {
        return toPr(JSON.parse(res.stdout));
    }
    catch {
        return null;
    }
}

async function storedPrNumber(cwd) {
    const branch = await currentBranch(cwd);
    if (!branch)
        return null;
    const n = (await tryRun(["git", "config", "--get", `branch.${branch}.muxy-pr-number`], cwd)).trim();
    return n || null;
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
    const argv = ["glab", "mr", "create", "--title", title, "--description", body ?? "", "--yes"];
    if (baseBranch)
        argv.push("--target-branch", baseBranch);
    if (draft)
        argv.push("--draft");
    return run(argv, cwd);
}

export function prMerge(cwd, { number, method, deleteBranch } = {}) {
    const argv = ["glab", "mr", "merge", String(number), "--yes"];
    if (method === "squash")
        argv.push("--squash");
    else if (method === "rebase")
        argv.push("--rebase");
    if (deleteBranch)
        argv.push("--remove-source-branch");
    return run(argv, cwd);
}

export function prClose(cwd, number) {
    return run(["glab", "mr", "close", String(number)], cwd);
}

export function prReady(cwd, { number } = {}) {
    return run(["glab", "mr", "update", String(number), "--ready"], cwd);
}

async function preparePrBranch(cwd, number) {
    const branch = `pr/${number}`;
    const startPoint = `refs/muxy/pr/${number}`;
    await run(["git", "fetch", "origin", `+refs/merge-requests/${number}/head:${startPoint}`], cwd);
    const onBranch = (await currentBranch(cwd)) === branch;
    if (!onBranch) {
        if (await localBranchExists(cwd, branch))
            await run(["git", "branch", "-f", branch, startPoint], cwd);
        else
            await run(["git", "branch", branch, startPoint], cwd);
    }
    await run(["git", "config", `branch.${branch}.muxy-pr-number`, String(number)], cwd);
    return branch;
}

export async function prCheckout(cwd, number) {
    const branch = await preparePrBranch(cwd, number);
    await run(["git", "switch", branch], cwd);
    return { branch };
}

export async function prepareWorktreeBranch(cwd, number) {
    return preparePrBranch(cwd, number);
}

export async function prDiff(cwd, number) {
    const startPoint = `refs/muxy/pr/${number}`;
    await run(["git", "fetch", "origin", `+refs/merge-requests/${number}/head:${startPoint}`], cwd);
    const pr = await prInfoFor(cwd, number);
    const baseRef = pr?.baseBranch ? `origin/${pr.baseBranch}` : "origin/HEAD";
    const mergeBase = (await tryRun(["git", "merge-base", baseRef, startPoint], cwd)).trim() || baseRef;
    const out = await run(["git", "diff", "--no-color", `${mergeBase}..${startPoint}`], cwd);
    return { diff: out };
}

function toRun(raw) {
    const s = String(raw.status ?? "").toLowerCase();
    const completed = ["success", "failed", "canceled", "skipped"].includes(s);
    const conclusion = s === "failed" ? "failure" : s === "canceled" ? "cancelled" : completed ? s : "";
    return {
        id: raw.id,
        title: raw.name || raw.ref || `#${raw.iid ?? raw.id}`,
        workflow: raw.source || "pipeline",
        status: completed ? "completed" : s === "running" ? "in_progress" : "queued",
        conclusion,
        branch: raw.ref || "",
        event: raw.source || "",
        url: raw.web_url || "",
        createdAt: raw.created_at || "",
    };
}

export async function runList(cwd, { limit } = {}) {
    const argv = ["glab", "ci", "list", "--output", "json"];
    if (limit)
        argv.push("--per-page", String(limit));
    const out = await run(argv, cwd);
    if (!out.trim())
        return [];
    const data = JSON.parse(out);
    return (Array.isArray(data) ? data : []).map(toRun);
}

export function runRerun(cwd, id) {
    return run(["glab", "ci", "retry", String(id)], cwd);
}

export function runCancel(cwd, id) {
    return run(["glab", "ci", "cancel", String(id)], cwd);
}
