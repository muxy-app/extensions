// GitHub Actions, read through the `gh` CLI so it reuses the user's existing
// `gh auth login` — no token for this extension to hold.

import { run, runJSON, CIError } from "../exec.js";
import { normalizeStatus, isActive } from "../model.js";

const LIST_FIELDS = [
  "databaseId", "number", "displayTitle", "workflowName", "status", "conclusion",
  "headBranch", "headSha", "event", "createdAt", "startedAt", "updatedAt", "url",
].join(",");

const DETAIL_FIELDS = `${LIST_FIELDS},jobs`;

export const capabilities = {
  jobs: true,
  logs: true,
  retry: true,
  cancel: true,
  environments: true,
};

function toRun(raw, source) {
  const status = normalizeStatus(raw.status, raw.conclusion);
  return {
    id: String(raw.databaseId),
    source: source.id,
    sourceKind: "github",
    sourceLabel: source.label || "GitHub Actions",
    number: raw.number != null ? `#${raw.number}` : "",
    title: raw.displayTitle || raw.workflowName || "",
    workflow: raw.workflowName || "",
    status,
    branch: raw.headBranch || "",
    sha: raw.headSha || "",
    event: raw.event || "",
    createdAt: raw.createdAt || "",
    startedAt: raw.startedAt || raw.createdAt || "",
    // GitHub keeps bumping `updatedAt` while a run is in flight, so it only
    // means "finished" once the run has actually stopped.
    finishedAt: isActive(status) ? "" : raw.updatedAt || "",
    durationMs: null,
    webUrl: raw.url || "",
    jobs: Array.isArray(raw.jobs) ? raw.jobs.map(toJob) : null,
  };
}

function toJob(raw) {
  return {
    id: String(raw.databaseId),
    name: raw.name || "",
    stage: "",
    status: normalizeStatus(raw.status, raw.conclusion),
    startedAt: raw.startedAt || "",
    finishedAt: raw.completedAt || "",
    durationMs: null,
    webUrl: raw.url || "",
    allowFailure: false,
    steps: (raw.steps || []).map((s) => ({
      name: s.name,
      number: s.number,
      status: normalizeStatus(s.status, s.conclusion),
    })),
  };
}

export async function loadRuns(source, cwd = "", { branch = "", limit = 30 } = {}) {
  const argv = ["gh", "run", "list", "--json", LIST_FIELDS, "-L", String(limit)];
  if (branch) argv.push("-b", branch);
  const raw = await runJSON(argv, cwd);
  return (Array.isArray(raw) ? raw : []).map((r) => toRun(r, source));
}

export async function loadRun(source, cwd, id) {
  const raw = await runJSON(["gh", "run", "view", String(id), "--json", DETAIL_FIELDS], cwd);
  return toRun(raw, source);
}

/**
 * The failed-step log for a run. `gh` emits one tab-separated line per log
 * line, which `logs.analyze` understands directly.
 */
export async function loadFailureLog(source, cwd, id) {
  try {
    return await run(["gh", "run", "view", String(id), "--log-failed"], cwd);
  } catch (e) {
    // Logs expire, and a run that failed before any step ran has none.
    if (e instanceof CIError && e.kind === "failed") return "";
    throw e;
  }
}

export async function retry(source, cwd, runId, { failedOnly = true, jobId = "" } = {}) {
  if (jobId) return run(["gh", "run", "rerun", "--job", String(jobId)], cwd);
  const argv = ["gh", "run", "rerun", String(runId)];
  if (failedOnly) argv.push("--failed");
  return run(argv, cwd);
}

export async function cancel(source, cwd, runId) {
  return run(["gh", "run", "cancel", String(runId)], cwd);
}

async function repoSlug(cwd) {
  return (await run(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd)).trim();
}

/**
 * Environments, newest deployment first. GitHub exposes deployment state only
 * through a per-deployment statuses call, so this is capped at the most recent
 * few environments rather than walking every deployment ever made.
 */
export async function loadEnvironments(source, cwd, { max = 8 } = {}) {
  const slug = await repoSlug(cwd);
  const deployments = await runJSON(
    ["gh", "api", `repos/${slug}/deployments?per_page=30`],
    cwd,
  );
  if (!Array.isArray(deployments)) return [];

  const newestByEnv = new Map();
  for (const d of deployments) {
    if (!d?.environment) continue;
    if (!newestByEnv.has(d.environment)) newestByEnv.set(d.environment, d);
    if (newestByEnv.size >= max) break;
  }

  const out = [];
  for (const [name, deployment] of newestByEnv) {
    let state = "unknown";
    let target = "";
    try {
      const statuses = await runJSON(
        ["gh", "api", `repos/${slug}/deployments/${deployment.id}/statuses?per_page=1`],
        cwd,
      );
      state = statuses?.[0]?.state || "unknown";
      target = statuses?.[0]?.environment_url || statuses?.[0]?.target_url || "";
    } catch (e) {
      console.warn("[ci-dashboard] deployment status unavailable:", e.message);
    }
    out.push({
      name,
      status: normalizeStatus(state === "inactive" ? "skipped" : state),
      ref: deployment.ref || "",
      sha: (deployment.sha || "").slice(0, 7),
      updatedAt: deployment.updated_at || deployment.created_at || "",
      webUrl: target || `https://github.com/${slug}/deployments/${encodeURIComponent(name)}`,
      externalUrl: target,
    });
  }
  return out;
}
