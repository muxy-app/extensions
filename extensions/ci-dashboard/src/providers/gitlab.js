// GitLab CI, read through `glab api` so the shapes are GitLab's documented
// REST responses rather than glab's porcelain output.
//
// The instance and project both come from the git remote, and every call is
// pinned to them (`--hostname` for reads, an explicit project id in the path).
// That is what makes a self-managed instance behave like gitlab.com.

import { exec, run, CIError } from "../exec.js";
import { normalizeStatus, isActive } from "../model.js";

export const capabilities = {
  jobs: true,
  logs: true,
  retry: true,
  cancel: true,
  environments: true,
};

// ------------------------------------------------------------- identity

/** Parses a git remote URL into `{ host, path }`. */
export function parseRemote(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  let host = "";
  let path = "";

  const scp = raw.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/);
  if (scp && !raw.includes("://")) {
    host = scp[1];
    path = scp[2];
  } else {
    try {
      const parsed = new URL(raw);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!host || !path || !path.includes("/")) return null;
  return { host: host.toLowerCase(), path };
}

const identityCache = new Map();

async function identity(cwd) {
  if (identityCache.has(cwd)) return identityCache.get(cwd);

  const remotes = (await run(["git", "remote"], cwd)).split("\n").map((s) => s.trim()).filter(Boolean);
  const ordered = [...remotes.filter((r) => r === "origin"), ...remotes.filter((r) => r !== "origin")];
  for (const remote of ordered) {
    const { stdout, code } = await exec(["git", "remote", "get-url", remote], cwd);
    if (code !== 0) continue;
    const parsed = parseRemote(stdout);
    if (parsed) {
      const value = { ...parsed, id: encodeURIComponent(parsed.path) };
      identityCache.set(cwd, value);
      return value;
    }
  }
  throw new CIError("failed", "Could not read a GitLab project from any git remote.");
}

export function clearIdentityCache() {
  identityCache.clear();
}

function query(params) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

async function api(endpoint, { host, cwd, method = "" } = {}) {
  const argv = ["glab", "api"];
  if (host) argv.push("--hostname", host);
  if (method) argv.push("-X", method);
  argv.push(endpoint);
  const stdout = await run(argv, cwd);
  try {
    return JSON.parse(stdout || "null");
  } catch {
    throw new CIError("failed", "Could not parse the GitLab API response.", stdout);
  }
}

/**
 * Same call, but returns the body as text. Job traces are plain text, not JSON,
 * so they cannot go through `api`.
 */
async function apiText(endpoint, { host, cwd } = {}) {
  const argv = ["glab", "api"];
  if (host) argv.push("--hostname", host);
  argv.push(endpoint);
  const { stdout, stderr, code } = await exec(argv, cwd);
  if (code !== 0) throw new CIError("failed", (stderr || stdout || "glab api failed").trim(), stderr);
  return stdout;
}

// -------------------------------------------------------------- mapping

function toRun(raw, source) {
  const status = normalizeStatus(raw.status);
  return {
    id: String(raw.id),
    source: source.id,
    sourceKind: "gitlab",
    sourceLabel: source.label || "GitLab CI",
    number: raw.iid != null ? `#${raw.iid}` : `#${raw.id}`,
    title: raw.name || raw.commit?.title || raw.ref || "",
    workflow: raw.source || "pipeline",
    status,
    branch: raw.ref || "",
    sha: raw.sha || "",
    event: raw.source || "",
    createdAt: raw.created_at || "",
    startedAt: raw.started_at || raw.created_at || "",
    finishedAt: isActive(status) ? "" : raw.finished_at || raw.updated_at || "",
    durationMs: typeof raw.duration === "number" ? raw.duration * 1000 : null,
    webUrl: raw.web_url || "",
    jobs: null,
  };
}

function toJob(raw) {
  return {
    id: String(raw.id),
    name: raw.name || "",
    stage: raw.stage || "",
    status: normalizeStatus(raw.status),
    startedAt: raw.started_at || "",
    finishedAt: raw.finished_at || "",
    durationMs: typeof raw.duration === "number" ? raw.duration * 1000 : null,
    webUrl: raw.web_url || "",
    allowFailure: Boolean(raw.allow_failure),
    failureReason: raw.failure_reason || "",
    steps: [],
  };
}

// ----------------------------------------------------------------- reads

export async function loadRuns(source, cwd = "", { branch = "", limit = 30 } = {}) {
  const { host, id } = await identity(cwd);
  const endpoint = `projects/${id}/pipelines${query({
    per_page: limit,
    order_by: "updated_at",
    sort: "desc",
    ref: branch,
  })}`;
  const raw = await api(endpoint, { host, cwd });
  return (Array.isArray(raw) ? raw : []).map((r) => toRun(r, source));
}

export async function loadRun(source, cwd, pipelineId) {
  const { host, id } = await identity(cwd);
  const [pipeline, jobs] = await Promise.all([
    api(`projects/${id}/pipelines/${pipelineId}`, { host, cwd }),
    api(`projects/${id}/pipelines/${pipelineId}/jobs${query({ per_page: 100 })}`, { host, cwd }),
  ]);
  const mapped = toRun(pipeline, source);
  mapped.jobs = Array.isArray(jobs) ? jobs.map(toJob) : [];
  return mapped;
}

/**
 * The trace of the first failed job in a pipeline. GitLab has no run-level
 * "failed log", so the failing job is selected here.
 */
export async function loadFailureLog(source, cwd, pipelineId, run_) {
  const { host, id } = await identity(cwd);
  const jobs = run_?.jobs?.length
    ? run_.jobs
    : (await api(`projects/${id}/pipelines/${pipelineId}/jobs${query({ per_page: 100 })}`, { host, cwd }) || []).map(toJob);
  const failed = jobs.find((j) => j.status === "failed" && !j.allowFailure) || jobs.find((j) => j.status === "failed");
  if (!failed) return "";
  try {
    return await apiText(`projects/${id}/jobs/${failed.id}/trace`, { host, cwd });
  } catch (e) {
    console.warn("[ci-dashboard] job trace unavailable:", e.message);
    return "";
  }
}

// ---------------------------------------------------------------- writes

export async function retry(source, cwd, pipelineId, { jobId = "" } = {}) {
  const { host, id } = await identity(cwd);
  const endpoint = jobId
    ? `projects/${id}/jobs/${jobId}/retry`
    : `projects/${id}/pipelines/${pipelineId}/retry`;
  return api(endpoint, { host, cwd, method: "POST" });
}

export async function cancel(source, cwd, pipelineId, { jobId = "" } = {}) {
  const { host, id } = await identity(cwd);
  const endpoint = jobId
    ? `projects/${id}/jobs/${jobId}/cancel`
    : `projects/${id}/pipelines/${pipelineId}/cancel`;
  return api(endpoint, { host, cwd, method: "POST" });
}

// --------------------------------------------------------- environments

export async function loadEnvironments(source, cwd, { max = 8 } = {}) {
  const { host, id } = await identity(cwd);
  const envs = await api(`projects/${id}/environments${query({ per_page: max })}`, { host, cwd });
  if (!Array.isArray(envs)) return [];

  const out = [];
  for (const env of envs.slice(0, max)) {
    // The list endpoint omits last_deployment on older instances; fill it in
    // from the single-environment endpoint only when it is actually missing.
    let deployment = env.last_deployment;
    if (!deployment) {
      try {
        const full = await api(`projects/${id}/environments/${env.id}`, { host, cwd });
        deployment = full?.last_deployment;
      } catch (e) {
        console.warn("[ci-dashboard] environment detail unavailable:", e.message);
      }
    }
    out.push({
      name: env.name,
      status: normalizeStatus(deployment?.status || (env.state === "available" ? "success" : "skipped")),
      ref: deployment?.ref || "",
      sha: (deployment?.sha || "").slice(0, 7),
      updatedAt: deployment?.created_at || env.updated_at || "",
      webUrl: env.external_url || deployment?.deployable?.web_url || "",
      externalUrl: env.external_url || "",
    });
  }
  return out;
}
