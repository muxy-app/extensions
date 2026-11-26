import { exec, run, tryRun, worktreeAddWith } from "@/core/git";
import { fromGh, rollupChecks, timeline } from "@/core/forge/normalize";

const DETAIL_FIELDS = "number,title,body,author,state,isDraft,url,headRefName,baseRefName,createdAt,updatedAt,mergeable,mergeStateStatus,reviewDecision,additions,deletions,changedFiles,comments,reviews,labels,statusCheckRollup";
const RUN_FIELDS = "databaseId,displayTitle,workflowName,status,conclusion,headBranch,event,url,createdAt";

export const kind = "github";

const LIST_FIELDS = "number,title,author,state,isDraft,url,headRefName,baseRefName,updatedAt,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup";

const withChecks = (raw) => fromGh({ ...raw, checks: rollupChecks(raw.statusCheckRollup) });

export async function list(filter, limit = 100) {
  const out = await run(["gh", "pr", "list", "--state", filter || "open", "--limit", String(limit), "--json", LIST_FIELDS]);
  return JSON.parse(out.trim() || "[]").map(withChecks);
}

export async function current() {
  const out = await tryRun(["gh", "pr", "view", "--json", LIST_FIELDS]);
  return out.trim() ? withChecks(JSON.parse(out)) : null;
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
  const res = await exec(["gh", "pr", "checks", String(number), "--json", "name,state,bucket,link,workflow"]).catch(() => null);
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
export const merge = (number, method) => run(["gh", "pr", "merge", String(number), `--${method || "merge"}`]);
export const close = (number) => run(["gh", "pr", "close", String(number)]);
export const ready = (pr) => run(["gh", "pr", "ready", String(pr.number)]);
export const updateBranch = (number) => run(["gh", "pr", "update-branch", String(number)]);
export const create = ({ title, body, baseBranch, draft }) =>
  run(["gh", "pr", "create", "--title", title, "--body", body || "", ...(baseBranch ? ["--base", baseBranch] : []), ...(draft ? ["--draft"] : [])]);
export const checkout = (number) => run(["gh", "pr", "checkout", String(number)]);

export const checkoutWorktree = (number, path) => worktreeAddWith(path, "gh", "pr", "checkout", String(number));

export const diff = (number) => run(["gh", "pr", "diff", String(number), "--color", "never"]);

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
