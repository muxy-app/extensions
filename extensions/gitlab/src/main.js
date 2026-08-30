// gitlab — Muxy panel for browsing and operating on GitLab issues and merge
// requests. Reads use `glab api` (the REST API); writes use glab subcommands.
// The instance and project both come from the current project's git remote, so
// gitlab.com and a self-managed install behave identically.

import { state, nav, isMR, thing } from "./state.js";
import { escapeHtml } from "./util.js";
import {
  GlabError, api, apiOptional, exec, write,
  encodeProjectPath, isAuthenticated, query, resolveProject,
} from "./glab.js";
import * as views from "./views.js";
import { renderActions, createArgs } from "./actions.js";

const refreshBtn = document.querySelector("#refresh");
const filterEl = document.querySelector("#state-filter");
const projectEl = document.querySelector("#project");
const modeEl = document.querySelector("#mode-switch");

// Hosts that are definitely not GitLab, so we can say so without a round trip.
const FOREIGN_HOSTS = /(^|\.)(github\.com|bitbucket\.org|dev\.azure\.com|codeberg\.org|sr\.ht)$/i;

const LIST_PARAMS = {
  per_page: 100,
  order_by: "updated_at",
  sort: "desc",
  with_labels_details: true,
};

/** The project the panel is pointed at, resolved and cached per working directory. */
let resolvedFor = null;

async function ensureProject() {
  if (state.project && resolvedFor === state.cwd) return state.project;

  // Clear the stale identity first, so an error screen never shows the host or
  // path of the project that was open before this one.
  state.host = "";
  state.labels = [];
  state.members = [];
  state.currentUser = null;
  views.setRepoLabel("", "");

  const { host, path } = await resolveProject(state.cwd);
  state.host = host;
  if (FOREIGN_HOSTS.test(host)) {
    throw new GlabError("foreign", `This project's remote points at ${host}.`);
  }

  const id = encodeProjectPath(path);
  const project = await api(`projects/${id}`, { host, cwd: state.cwd });
  if (!project?.id) throw new GlabError("not-found", `${host}/${path} could not be read.`);

  state.project = project;
  resolvedFor = state.cwd;
  views.setRepoLabel(host, project.path_with_namespace || path);

  // Colors for labels that arrive as bare names, the assignee picker list, and
  // the signed-in user for the "Mine" filter. None of the three is essential,
  // so a failure in any of them must not block the panel.
  const [labels, members, currentUser] = await Promise.all([
    apiOptional(`projects/${id}/labels${query({ per_page: 100, with_counts: false })}`, { host, cwd: state.cwd }),
    apiOptional(`projects/${id}/members/all${query({ per_page: 100 })}`, { host, cwd: state.cwd }),
    apiOptional("user", { host, cwd: state.cwd }),
  ]);
  state.labels = Array.isArray(labels) ? labels : [];
  state.members = Array.isArray(members) ? members : [];
  state.currentUser = currentUser?.id ? currentUser : null;

  return project;
}

function projectEndpoint(suffix) {
  return `projects/${encodeProjectPath(state.project.path_with_namespace)}/${suffix}`;
}

const apiOpts = () => ({ host: state.host, cwd: state.cwd });

// ------------------------------------------------------------------- loads

async function loadList() {
  if (state.loading) return;
  state.loading = true;
  state.item = null;
  refreshBtn.classList.add("is-spinning");
  views.renderLoading();
  try {
    await ensureProject();
    const endpoint = projectEndpoint(
      `${isMR() ? "merge_requests" : "issues"}${query({ ...LIST_PARAMS, state: state.filter })}`,
    );
    const items = await api(endpoint, apiOpts());
    views.renderList(Array.isArray(items) ? items : []);
  } catch (e) {
    await handleError(e);
  } finally {
    state.loading = false;
    refreshBtn.classList.remove("is-spinning");
  }
}

async function loadDetail(iid) {
  refreshBtn.classList.add("is-spinning");
  views.renderDetailLoading();
  try {
    await ensureProject();
    const base = projectEndpoint(`${isMR() ? "merge_requests" : "issues"}/${encodeURIComponent(iid)}`);
    const item = await api(base, apiOpts());

    const [notes, approvals] = await Promise.all([
      apiOptional(`${base}/notes${query({ per_page: 100, sort: "asc", order_by: "created_at" })}`, apiOpts()),
      isMR() ? apiOptional(`${base}/approvals`, apiOpts()) : Promise.resolve(null),
    ]);

    state.item = item;
    views.renderDetail(item, { notes: Array.isArray(notes) ? notes : [], approvals });
    renderActions(item, approvals);
  } catch (e) {
    await handleError(e);
  } finally {
    refreshBtn.classList.remove("is-spinning");
  }
}

// ------------------------------------------------------------------ create

function renderCreate() {
  const what = thing();
  const mr = isMR();
  const defaultBranch = state.project?.default_branch || "";
  views.content.innerHTML = `
    <div class="detail">
      <button class="detail__back" id="back">← Back to list</button>
      <div id="flash" class="flash" hidden></div>
      <div class="detail__title">New ${escapeHtml(what)}</div>
      ${mr ? `<div class="detail__stats">Created from the current branch.</div>` : ""}
      <div class="form">
        <input class="inp" id="n-title" placeholder="Title" />
        <textarea class="ta" id="n-body" placeholder="Description (Markdown supported)"></textarea>
        ${mr ? `
          <div class="form__group">
            <div class="form__label">Target branch</div>
            <input class="inp" id="n-target" placeholder="Target branch" value="${escapeHtml(defaultBranch)}" />
          </div>
          <label class="check"><input type="checkbox" id="n-push" checked> Push the current branch first</label>
          <label class="check"><input type="checkbox" id="n-draft"> Create as a draft</label>
          <label class="check"><input type="checkbox" id="n-rm"> Delete source branch when merged</label>` : ""}
        <div class="form__actions">
          <button class="btn btn--accent" id="n-submit">Create</button>
        </div>
      </div>
    </div>`;

  document.querySelector("#back").addEventListener("click", loadList);
  document.querySelector("#n-submit").addEventListener("click", async () => {
    const title = document.querySelector("#n-title").value.trim();
    if (!title) return views.flash("Title is empty.", "error");

    refreshBtn.classList.add("is-spinning");
    try {
      await write(createArgs({
        title,
        body: document.querySelector("#n-body").value,
        target: mr ? document.querySelector("#n-target").value.trim() : "",
        push: mr && document.querySelector("#n-push").checked,
        draft: mr && document.querySelector("#n-draft").checked,
        removeBranch: mr && document.querySelector("#n-rm").checked,
      }), { repo: state.project?.web_url, cwd: state.cwd });
      await loadList();
    } catch (e) {
      views.flash((e.message || String(e)).trim().slice(0, 240), "error");
    } finally {
      refreshBtn.classList.remove("is-spinning");
    }
  });
}

// ------------------------------------------------------------------ errors

async function handleError(e) {
  if (!(e instanceof GlabError)) {
    return views.renderError("An error occurred", escapeHtml(e?.message || String(e)));
  }
  switch (e.kind) {
    case "missing":
      return views.renderGlabMissing(installGlab);
    case "auth":
      return views.renderSignIn(state.host);
    case "no-repo":
    case "foreign":
      return views.renderNotGitLab(state.host, e.message);
    case "not-found":
      // GitLab hides private projects behind a 404 rather than a 401, so an
      // instance we hold no token for looks identical to a missing project
      // until we ask whether this host is authenticated at all.
      if (state.host && !(await isAuthenticated(state.host, state.cwd))) {
        return views.renderSignIn(state.host);
      }
      return views.renderNotGitLab(
        state.host,
        "The project could not be read. Check that the git remote points at a GitLab project you have access to.",
      );
    default:
      return views.renderError("Request failed", `<code>${escapeHtml(e.message.slice(0, 300))}</code>`);
  }
}

async function installGlab() {
  const btn = document.querySelector("#install");
  const status = document.querySelector("#install-status");
  btn.disabled = true;
  btn.textContent = "Installing…";
  status.hidden = false;
  status.textContent = "Running brew install glab — this can take a minute.";
  try {
    const { code, stdout, stderr } = await exec(["brew", "install", "glab"]);
    if (code === 0) {
      status.textContent = "Installed. Reloading…";
      return loadList();
    }
    const out = `${stderr || ""}${stdout || ""}`.toLowerCase();
    status.textContent = out.includes("command not found") || out.includes("no such file")
      ? "Homebrew isn't installed. Install Homebrew from brew.sh first, or install glab manually from gitlab.com/gitlab-org/cli."
      : (stderr || stdout || "Installation failed.").trim().slice(0, 300);
  } catch (e) {
    status.textContent = e.message || String(e);
  } finally {
    btn.disabled = false;
    btn.textContent = "Retry install";
  }
}

// ------------------------------------------------------------------ wiring

nav.list = loadList;
nav.detail = loadDetail;
nav.create = renderCreate;

/** "Merged" is a merge-request-only state, so the filter adapts to the mode. */
function syncFilter() {
  const mergedBtn = filterEl.querySelector('[data-state="merged"]');
  mergedBtn.hidden = !isMR();
  if (!isMR() && state.filter === "merged") state.filter = "opened";
  filterEl.querySelectorAll(".seg__btn").forEach((b) =>
    b.classList.toggle("is-active", b.getAttribute("data-state") === state.filter));
}

modeEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg__btn");
  if (!btn) return;
  const next = btn.getAttribute("data-mode");
  if (next === state.mode) return;
  state.mode = next;
  modeEl.querySelectorAll(".seg__btn").forEach((b) => b.classList.toggle("is-active", b === btn));
  syncFilter();
  loadList();
});

filterEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg__btn");
  if (!btn || btn.hidden) return;
  const next = btn.getAttribute("data-state");
  if (next === state.filter) return;
  state.filter = next;
  syncFilter();
  loadList();
});

projectEl.addEventListener("change", () => {
  state.cwd = projectEl.value;
  state.project = null;
  resolvedFor = null;
  views.setRepoLabel("", "");
  loadList();
});

refreshBtn.addEventListener("click", () => {
  state.project = null;
  resolvedFor = null;
  loadList();
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
    // If the pinned project is no longer open the select falls back to
    // "Current project"; keep the state in step rather than reading a stale cwd.
    projectEl.value = state.cwd;
    if (projectEl.value !== state.cwd) {
      state.cwd = "";
      state.project = null;
      resolvedFor = null;
    }
  } catch (e) {
    console.warn("[gitlab] could not list projects:", e);
  }
}

// Follow the active project while the picker is on "Current project".
if (window.muxy?.events?.subscribe) {
  window.muxy.events.subscribe("project.switched", async () => {
    await loadProjects();
    if (!state.cwd) {
      state.project = null;
      resolvedFor = null;
      views.setRepoLabel("", "");
      loadList();
    }
  });
}

// --------------------------------------------------------------------- boot
(async () => {
  syncFilter();
  await loadProjects();
  loadList();
})();
