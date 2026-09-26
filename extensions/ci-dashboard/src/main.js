// ci-dashboard — a unified CI/CD panel for the active project.
//
// Sources are configured per repository and loaded independently, so a GitHub
// Actions repo, a GitLab CI repo, and a TeamCity CCTray feed all render through
// the same normalized model — and one unreachable source never blanks the rest.

import { state, nav, enabledSources, sourceById } from "./state.js";
import { escapeHtml } from "./util.js";
import { STATUS, lastGreenBefore, filterByBranch, isActive } from "./model.js";
import { analyze } from "./logs.js";
import { isAvailable, openUrl, CIError } from "./exec.js";
import { currentBranch, branches, commitsBetween, hasCommits } from "./git.js";
import { loadConfig, saveConfig } from "./storage.js";
import { detect, suggestedSources } from "./providers/detect.js";
import * as providers from "./providers/index.js";
import { content, renderLoading, renderError, flash, messageFor } from "./views/chrome.js";
import { renderRuns } from "./views/runs.js";
import { renderDetail, renderDetailLoading } from "./views/detail.js";
import { renderEnvironments } from "./views/environments.js";
import { renderSources, bindSources, resetSourcesView } from "./views/sources.js";

const refreshBtn = document.querySelector("#refresh");
const sourcesBtn = document.querySelector("#sources");
const viewEl = document.querySelector("#view-switch");
const projectEl = document.querySelector("#project");
const branchEl = document.querySelector("#branch");
const sourcebarEl = document.querySelector("#sourcebar");

// Refresh cadence while something is still building. Only ticks when the panel
// is visible and at least one run is active, so an idle repo costs nothing.
const ACTIVE_POLL_MS = 20000;
let pollTimer = null;

// ---------------------------------------------------------------- bootstrap

let preparedFor = null;

/** Resolves the repository, loads its stored config, and seeds detection. */
async function prepare() {
  if (preparedFor === state.cwd) return;

  const info = await repoInfo();
  state.repoRoot = info?.root || state.cwd || "";
  state.config = await loadConfig(state.repoRoot);
  state.detection = await detect(state.cwd);

  // A repository with nothing stored starts from what is actually checked in,
  // so the common case needs no configuration at all.
  if (!state.config.sources.length && !state.config.detectionDismissed) {
    const suggested = await suggestedSources(state.detection, isAvailable);
    if (suggested.length) {
      state.config = { ...state.config, sources: suggested };
      await saveConfig(state.repoRoot, state.config);
    }
  }

  state.currentBranch = await currentBranch(state.cwd);
  state.branches = await branches(state.cwd);
  if (state.branch === null || state.branch === undefined) state.branch = state.currentBranch;
  syncBranchPicker();
  preparedFor = state.cwd;
}

async function repoInfo() {
  try {
    return await window.muxy?.git?.repoInfo?.(state.cwd ? { project: state.cwd } : undefined);
  } catch (e) {
    console.warn("[ci-dashboard] could not resolve the repository:", e);
    return null;
  }
}

function invalidate() {
  preparedFor = null;
  state.runs = [];
  state.errors = [];
  state.environments = [];
  state.envErrors = [];
  state.run = null;
  resetSourcesView();
  // The GitLab provider caches its git-remote identity by cwd, and "" (follow
  // the active project) never changes as a string — so without this, switching
  // between two GitLab-backed repos while the picker stays on "Current
  // project" would keep serving the first repo's pipelines under the new one.
  providers.gitlab.clearIdentityCache();
}

// -------------------------------------------------------------------- views

async function showRuns() {
  state.view = "runs";
  syncViewSwitch();
  if (state.loading) return;
  state.loading = true;
  refreshBtn.classList.add("is-spinning");
  renderLoading();
  try {
    await prepare();
    if (!enabledSources().length) return showSources();

    const { runs, errors } = await providers.loadAll(enabledSources(), state.cwd, {
      branch: state.branch,
      limit: 30,
    });
    // Providers that cannot filter server-side are narrowed here.
    state.runs = filterByBranch(runs, state.branch);
    state.errors = errors;
    renderSourceBar();
    renderRuns();
    schedulePoll();
  } catch (e) {
    renderError("Could not load pipelines", `<code>${escapeHtml(messageFor(e))}</code>`);
  } finally {
    state.loading = false;
    refreshBtn.classList.remove("is-spinning");
  }
}

async function showDetail(sourceId, runId) {
  state.view = "runs";
  stopPoll();
  renderDetailLoading();
  refreshBtn.classList.add("is-spinning");
  try {
    await prepare();
    const source = sourceById(sourceId);
    if (!source) return showRuns();
    const capabilities = providers.capabilitiesFor(source);

    // The list already carries a usable run; re-read it when the provider can
    // return a richer record (jobs, precise timings).
    const listed = state.runs.find((r) => r.id === runId && r.source === sourceId);
    const run = capabilities.jobs ? await providers.loadRun(source, state.cwd, runId) : listed;
    if (!run) return showRuns();
    run.source = sourceId;
    run.sourceLabel = listed?.sourceLabel || providers.labelFor(source);
    state.run = run;

    const [analysis, logError] = await failureAnalysis(source, run, capabilities);
    const sinceGreen = await sinceLastGreen(run);

    renderDetail({
      run,
      capabilities,
      analysis,
      logError,
      sinceGreen,
      onRetry: (opts) => act(() => providers.retry(source, state.cwd, run.id, opts), "Retry requested"),
      onCancel: () => act(() => providers.cancel(source, state.cwd, run.id), "Cancel requested"),
    });
  } catch (e) {
    renderError("Could not load this pipeline", `<code>${escapeHtml(messageFor(e))}</code>`);
  } finally {
    refreshBtn.classList.remove("is-spinning");
  }
}

/** Fetches and analyzes the failure log, but only for a run that failed. */
async function failureAnalysis(source, run, capabilities) {
  if (run.status !== STATUS.failed || !capabilities.logs) return [null, null];
  try {
    const raw = await providers.loadFailureLog(source, state.cwd, run.id, run);
    return [raw ? analyze(raw) : null, null];
  } catch (e) {
    return [null, e];
  }
}

/**
 * "What broke since my last successful pipeline?" — the commits between the
 * newest green run on this branch and the one being viewed.
 */
async function sinceLastGreen(run) {
  if (run.status !== STATUS.failed || !run.sha) return null;
  const baseline = lastGreenBefore(state.runs, run);
  if (!baseline) return { reason: "No earlier successful pipeline in the loaded history." };
  if (!(await hasCommits([baseline.sha, run.sha], state.cwd))) {
    return { reason: `Commits ${baseline.sha.slice(0, 7)}…${run.sha.slice(0, 7)} are not in this checkout — pull them locally to compare.` };
  }
  const commits = await commitsBetween(baseline.sha, run.sha, state.cwd);
  return { baseline, commits };
}

async function act(fn, okMessage) {
  refreshBtn.classList.add("is-spinning");
  try {
    await fn();
    flash(okMessage, "ok");
    // Give the server a moment to register the state change before re-reading.
    setTimeout(() => state.run && showDetail(state.run.source, state.run.id), 1200);
  } catch (e) {
    flash(messageFor(e), "error");
  } finally {
    refreshBtn.classList.remove("is-spinning");
  }
}

async function showEnvironments() {
  state.view = "envs";
  syncViewSwitch();
  stopPoll();
  refreshBtn.classList.add("is-spinning");
  renderLoading(4);
  try {
    await prepare();
    const { environments, errors } = await providers.loadAllEnvironments(enabledSources(), state.cwd);
    state.environments = environments;
    state.envErrors = errors;
    renderEnvironments();
  } catch (e) {
    renderError("Could not load environments", `<code>${escapeHtml(messageFor(e))}</code>`);
  } finally {
    refreshBtn.classList.remove("is-spinning");
  }
}

async function showSources() {
  state.view = "sources";
  syncViewSwitch();
  stopPoll();
  try {
    await prepare();
    renderSources();
  } catch (e) {
    renderError("Could not read this project", `<code>${escapeHtml(messageFor(e))}</code>`);
  }
}

/** Persists a config change from the sources view and re-renders. */
async function persistConfig(next) {
  state.config = next;
  await saveConfig(state.repoRoot, next);
  renderSources();
  renderSourceBar();
}

// ------------------------------------------------------------------- chrome

function renderSourceBar() {
  const sources = enabledSources();
  if (!sources.length) {
    sourcebarEl.textContent = "";
    return;
  }
  const failing = new Set(state.errors.map((e) => e.sourceId));
  sourcebarEl.innerHTML = sources
    .map((s) => `<span class="${failing.has(s.id) ? "st-failed" : ""}">${escapeHtml(providers.labelFor(s))}</span>`)
    .join('<span class="run__sep"> · </span>');
}

function syncViewSwitch() {
  viewEl.querySelectorAll(".seg__btn").forEach((b) =>
    b.classList.toggle("is-active", b.getAttribute("data-view") === (state.view === "sources" ? "" : state.view)));
}

function syncBranchPicker() {
  const options = [...new Set([state.currentBranch, ...state.branches].filter(Boolean))];
  branchEl.length = 1;
  for (const branch of options) {
    const opt = document.createElement("option");
    opt.value = branch;
    opt.textContent = branch === state.currentBranch ? `${branch} (current)` : branch;
    branchEl.appendChild(opt);
  }
  branchEl.value = state.branch;
  // A stored branch that no longer exists falls back to "All branches".
  if (branchEl.value !== state.branch) state.branch = "";
}

// --------------------------------------------------------------- polling

function schedulePoll() {
  stopPoll();
  if (document.hidden) return;
  if (!state.runs.some((r) => isActive(r.status))) return;
  pollTimer = setTimeout(() => {
    if (state.view === "runs" && !state.run) showRuns();
  }, ACTIVE_POLL_MS);
}

function stopPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPoll();
  else if (state.view === "runs" && !state.run) schedulePoll();
});

// ------------------------------------------------------------------ wiring

nav.runs = () => { state.run = null; showRuns(); };
nav.detail = showDetail;
nav.envs = showEnvironments;
nav.sources = showSources;
nav.reload = () => { invalidate(); showRuns(); };
bindSources(persistConfig);

viewEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg__btn");
  if (!btn) return;
  const next = btn.getAttribute("data-view");
  if (next === state.view) return;
  state.run = null;
  if (next === "envs") showEnvironments();
  else showRuns();
});

sourcesBtn.addEventListener("click", () => showSources());

refreshBtn.addEventListener("click", () => {
  if (state.view === "envs") return showEnvironments();
  if (state.run) return showDetail(state.run.source, state.run.id);
  state.runs = [];
  showRuns();
});

branchEl.addEventListener("change", () => {
  state.branch = branchEl.value;
  state.run = null;
  showRuns();
});

projectEl.addEventListener("change", () => {
  state.cwd = projectEl.value;
  state.branch = "";
  invalidate();
  showRuns();
});

async function loadProjects() {
  try {
    if (!window.muxy?.projects?.list) return;
    const projects = await window.muxy.projects.list();
    if (!Array.isArray(projects) || !projects.length) return;
    projectEl.length = 1;
    for (const p of projects) {
      const path = p?.path || p?.root || p?.dir || p?.directory || "";
      if (!path) continue;
      const opt = document.createElement("option");
      opt.value = path;
      opt.textContent = p.name || path.split("/").pop() || path;
      projectEl.appendChild(opt);
    }
    projectEl.value = state.cwd;
    if (projectEl.value !== state.cwd) {
      state.cwd = "";
      invalidate();
    }
  } catch (e) {
    console.warn("[ci-dashboard] could not list projects:", e);
  }
}

if (window.muxy?.events?.subscribe) {
  window.muxy.events.subscribe("project.switched", async () => {
    await loadProjects();
    if (!state.cwd) {
      state.branch = "";
      invalidate();
      showRuns();
    }
  });
  // The panel's own header buttons dispatch these.
  window.muxy.events.subscribe("command.refresh-ci", () => refreshBtn.click());
  window.muxy.events.subscribe("command.open-ci-sources", () => showSources());
}

// --------------------------------------------------------------------- boot
(async () => {
  state.branch = null; // prepare() seeds this from the checked-out branch
  await loadProjects();
  showRuns();
})();

export { content, openUrl, CIError };
