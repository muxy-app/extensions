import { run } from "./exec.js";

const NO_CHECKS = { status: "none", total: 0, passing: 0, failing: 0, pending: 0 };

function toPr(raw) {
    return {
        number: raw.number,
        title: raw.title ?? "",
        author: raw.author ?? "",
        headBranch: raw.headBranch ?? "",
        baseBranch: raw.baseBranch ?? "",
        state: String(raw.state ?? "").toLowerCase(),
        url: raw.url ?? "",
        isDraft: !!raw.isDraft,
        mergeable: raw.mergeable ?? null,
        mergeStateStatus: raw.mergeStateStatus ?? "",
        checks: raw.checks ?? NO_CHECKS,
    };
}

export async function prList({ filter, limit } = {}) {
    const prs = await muxy.git.pr.list({ filter: filter || "open", limit });
    return prs.map(toPr);
}

export async function prInfo() {
    try {
        const pr = await muxy.git.pr.info();
        return pr ? toPr(pr) : null;
    }
    catch {
        return null;
    }
}

export function prCreate({ title, body, baseBranch, draft } = {}) {
    return muxy.git.pr.create({ title, body: body ?? "", baseBranch, draft: !!draft });
}

export function prMerge({ number, method, deleteBranch } = {}) {
    return muxy.git.pr.merge({ number, method: method || "merge", deleteBranch: !!deleteBranch });
}

export function prClose(number) {
    return muxy.git.pr.close({ number });
}

export function prReady({ number } = {}) {
    return run(["gh", "pr", "ready", String(number)]);
}

export function prCheckout(number) {
    return muxy.git.pr.checkout({ number });
}

export async function prCheckoutWorktree(number, path) {
    const { branch } = await muxy.git.pr.checkoutWorktree({ number, path });
    return branch;
}

async function prDiffFallback(number) {
    return {
        diff: await run(["gh", "pr", "diff", String(number), "--color", "never"]),
        truncated: false,
    };
}

export async function prDiff(number) {
    try {
        const result = await muxy.git.pr.diff({ number });
        if (result.diff?.trim())
            return result;
    }
    catch {
        return prDiffFallback(number);
    }
    return prDiffFallback(number);
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

export async function runList({ limit } = {}) {
    const argv = ["gh", "run", "list", "--json", RUN_FIELDS];
    if (limit)
        argv.push("--limit", String(limit));
    const out = await run(argv);
    if (!out.trim())
        return [];
    return JSON.parse(out).map(toRun);
}

export function runRerun(id, { failedOnly } = {}) {
    const argv = ["gh", "run", "rerun", String(id)];
    if (failedOnly)
        argv.push("--failed");
    return run(argv);
}

export function runCancel(id) {
    return run(["gh", "run", "cancel", String(id)]);
}
