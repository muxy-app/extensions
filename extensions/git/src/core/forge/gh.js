import { run } from "@/core/git";
import { fromGh, rollupChecks, timeline } from "@/core/forge/normalize";

const DETAIL_FIELDS = "number,title,body,author,state,isDraft,url,headRefName,baseRefName,createdAt,updatedAt,mergeable,mergeStateStatus,reviewDecision,additions,deletions,changedFiles,comments,reviews,labels,statusCheckRollup";
const RUN_FIELDS = "databaseId,displayTitle,workflowName,status,conclusion,headBranch,event,url,createdAt";

export const kind = "github";

export async function list(filter, limit = 100) {
  return (await muxy.git.pr.list({ filter, limit, checks: true })).map(fromGh);
}

export async function current({ fresh = false } = {}) {
  const pr = await muxy.git.pr.info({ fresh });
  return pr ? fromGh(pr) : null;
}

export async function details(number) {
  const raw = JSON.parse(await run(["gh", "pr", "view", String(number), "--json", DETAIL_FIELDS]));
  return {
    ...fromGh({ ...raw, checks: rollupChecks(raw.statusCheckRollup) }),
    body: String(raw.body ?? ""),
    createdAt: String(raw.createdAt ?? ""),
    additions: Number(raw.additions) || 0,
    deletions: Number(raw.deletions) || 0,
    changedFiles: Number(raw.changedFiles) || 0,
    labels: (raw.labels ?? []).map((label) => String(label.name ?? label)).filter(Boolean),
    timeline: timeline(raw.comments ?? [], raw.reviews ?? []),
  };
}

export async function checks(number) {
  const res = await muxy.exec(["gh", "pr", "checks", String(number), "--json", "name,state,bucket,link,workflow"]).catch(() => null);
  try {
    return JSON.parse(res?.stdout || "[]").map((check) => ({
      name: String(check.name ?? ""),
      workflow: String(check.workflow ?? ""),
      bucket: String(check.bucket ?? check.state ?? "").toLowerCase(),
      link: String(check.link ?? ""),
    }));
  } catch {
    return [];
  }
}

export const comment = (number, body) => run(["gh", "pr", "comment", String(number), "--body-file", "-"], { stdin: body });
export const merge = (number, method) => muxy.git.pr.merge({ number, method, deleteBranch: false });
export const close = (number) => muxy.git.pr.close({ number });
export const ready = (pr) => run(["gh", "pr", "ready", String(pr.number)]);
export const updateBranch = (number) => run(["gh", "pr", "update-branch", String(number)]);
export const create = ({ title, body, baseBranch, draft }) => muxy.git.pr.create({ title, body, baseBranch, draft });
export const checkout = (number) => muxy.git.pr.checkout({ number });

export async function checkoutWorktree(number, path) {
  await muxy.git.pr.checkoutWorktree({ number, path });
}

export async function diff(number) {
  try {
    const result = await muxy.git.pr.diff({ number });
    if (result?.diff?.trim()) return result.diff;
  } catch {}
  return run(["gh", "pr", "diff", String(number), "--color", "never"]);
}

export async function runs({ branch, limit = 40 } = {}) {
  const argv = ["gh", "run", "list", "--json", RUN_FIELDS, "--limit", String(limit)];
  if (branch) argv.push("--branch", branch);
  const out = await run(argv);
  return JSON.parse(out.trim() || "[]").map((raw) => ({
    id: raw.databaseId,
    title: String(raw.displayTitle || raw.workflowName || ""),
    workflow: String(raw.workflowName ?? ""),
    status: String(raw.status ?? "").toLowerCase(),
    conclusion: String(raw.conclusion ?? "").toLowerCase(),
    branch: String(raw.headBranch ?? ""),
    event: String(raw.event ?? ""),
    url: String(raw.url ?? ""),
    createdAt: String(raw.createdAt ?? ""),
  }));
}

export const rerun = (id, failedOnly) => run(["gh", "run", "rerun", String(id), ...(failedOnly ? ["--failed"] : [])]);
export const cancelRun = (id) => run(["gh", "run", "cancel", String(id)]);
