import { run, tryRun } from "@/lib/forge/exec";

const PR_FIELDS = "index,state,title,author,url,mergeable,base,head,ci";

async function currentBranch() {
    return (await tryRun(["git", "branch", "--show-current"])).trim();
}

async function localBranchExists(branch) {
    const res = await muxy.exec(["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return res.exitCode === 0;
}

function asString(value) {
    if (value == null)
        return "";
    if (typeof value === "string")
        return value;
    if (typeof value === "object")
        return value.ref ?? value.name ?? value.label ?? value.login ?? value.username ?? "";
    return String(value);
}

function mapMergeable(value) {
    if (value === true || value === "true")
        return true;
    if (value === false || value === "false")
        return false;
    return null;
}

function ciStatus(value) {
    const s = String(value ?? "").toLowerCase();
    if (!s || s === "unknown" || s === "-")
        return "none";
    if (s.includes("fail") || s.includes("error"))
        return "failure";
    if (s.includes("pend") || s.includes("running") || s.includes("progress") || s.includes("wait"))
        return "pending";
    if (s.includes("success") || s.includes("pass"))
        return "success";
    return "none";
}

function checksFromCi(value) {
    const status = ciStatus(value);
    return {
        status,
        total: status === "none" ? 0 : 1,
        passing: status === "success" ? 1 : 0,
        failing: status === "failure" ? 1 : 0,
        pending: status === "pending" ? 1 : 0,
    };
}

function resolveState(raw) {
    if (raw.merged || raw.merged_at || raw.has_merged)
        return "merged";
    return String(raw.state ?? "").toLowerCase() || "open";
}

function normalizePr(raw) {
    const title = asString(raw.title);
    const state = resolveState(raw);
    return {
        number: Number(raw.index ?? raw.number) || 0,
        title,
        author: asString(raw.author ?? raw.user ?? raw.poster),
        headBranch: asString(raw.head),
        baseBranch: asString(raw.base),
        state,
        url: asString(raw.html_url ?? raw.url),
        isDraft: /^wip:/i.test(title.trim()),
        mergeable: state === "open" ? mapMergeable(raw.mergeable) : null,
        mergeStateStatus: "",
        checks: checksFromCi(raw.ci ?? raw.status),
    };
}

function teaQueryState(filter) {
    if (filter === "merged" || filter === "closed")
        return "closed";
    if (filter === "all")
        return "all";
    return "open";
}

function matchesFilter(pr, filter) {
    if (filter === "merged")
        return pr.state === "merged";
    if (filter === "closed")
        return pr.state === "closed";
    return true;
}

export async function prList({ filter, limit } = {}) {
    const argv = ["tea", "pr", "list", "--state", teaQueryState(filter), "--fields", PR_FIELDS, "--output", "json"];
    if (limit)
        argv.push("--limit", String(limit));
    const out = await tryRun(argv);
    if (!out.trim())
        return [];
    try {
        const data = JSON.parse(out);
        const rows = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
        return rows.map(normalizePr).filter((pr) => matchesFilter(pr, filter));
    }
    catch {
        return [];
    }
}

async function findPrByNumber(number) {
    const all = await prList({ filter: "all", limit: 200 });
    return all.find((p) => String(p.number) === String(number)) ?? null;
}

async function storedPrNumber() {
    const branch = await currentBranch();
    if (!branch)
        return null;
    const n = (await tryRun(["git", "config", "--get", `branch.${branch}.muxy-pr-number`])).trim();
    return n || null;
}

export async function prInfo() {
    try {
        const stored = await storedPrNumber();
        if (stored) {
            const byNumber = await findPrByNumber(stored);
            if (byNumber)
                return byNumber;
        }
        const branch = await currentBranch();
        if (!branch)
            return null;
        const all = await prList({ filter: "all", limit: 200 });
        return all.find((p) => p.headBranch === branch || p.headBranch.endsWith(`:${branch}`)) ?? null;
    }
    catch {
        return null;
    }
}

export function prCreate({ title, body, baseBranch, draft } = {}) {
    const finalTitle = draft ? `WIP: ${title}` : title;
    const argv = ["tea", "pr", "create", "--title", finalTitle, "--description", body ?? ""];
    if (baseBranch)
        argv.push("--base", baseBranch);
    return run(argv);
}

export function prMerge({ number, method } = {}) {
    const style = method === "squash" ? "squash" : method === "rebase" ? "rebase" : "merge";
    return run(["tea", "pr", "merge", "--style", style, String(number)]);
}

export function prClose(number) {
    return run(["tea", "pr", "close", String(number)]);
}

export function prReady({ number, title } = {}) {
    const original = String(title ?? "");
    const stripped = original.replace(/^\s*(?:wip:|\[wip\])\s*/i, "").trim();
    return run(["tea", "pr", "edit", "--title", stripped || original, String(number)]);
}

async function preparePrBranch(number) {
    const branch = `pr/${number}`;
    const startPoint = `refs/muxy/pr/${number}`;
    await run(["git", "fetch", "origin", `+refs/pull/${number}/head:${startPoint}`]);
    const onBranch = (await currentBranch()) === branch;
    if (!onBranch) {
        if (await localBranchExists(branch))
            await run(["git", "branch", "-f", branch, startPoint]);
        else
            await run(["git", "branch", branch, startPoint]);
    }
    await run(["git", "config", `branch.${branch}.muxy-pr-number`, String(number)]);
    return branch;
}

export async function prCheckout(number) {
    const branch = await preparePrBranch(number);
    await run(["git", "switch", branch]);
    return { branch };
}

export async function prCheckoutWorktree(number, path) {
    const branch = await preparePrBranch(number);
    await muxy.git.worktree.add({ path, branch, createBranch: false });
    return branch;
}

export async function runList() {
    throw new Error("Action runs are only available on GitHub repositories.");
}

export async function runRerun() {
    throw new Error("Action runs are only available on GitHub repositories.");
}

export async function runCancel() {
    throw new Error("Action runs are only available on GitHub repositories.");
}

export async function prDiff(number) {
    const startPoint = `refs/muxy/pr/${number}`;
    await run(["git", "fetch", "origin", `+refs/pull/${number}/head:${startPoint}`]);
    const pr = await findPrByNumber(number);
    const baseRef = pr?.baseBranch ? `origin/${pr.baseBranch.replace(/^.*:/, "")}` : "origin/HEAD";
    const mergeBase = (await tryRun(["git", "merge-base", baseRef, startPoint])).trim() || baseRef;
    const out = await run(["git", "diff", "--no-color", `${mergeBase}..${startPoint}`]);
    return { diff: out };
}
