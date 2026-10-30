// Rendering. Every function here writes into #content and wires its own
// listeners; navigation goes back out through `nav`.

import { state, nav, isMR, thing } from "./state.js";
import { escapeHtml, timeAgo, avatarHtml, metaRow, userName } from "./util.js";
import { renderMarkdown } from "./markdown.js";
import { openUrl } from "./glab.js";
import * as icons from "./icons.js";

const content = document.querySelector("#content");
const repoEl = document.querySelector("#repo");

// -------------------------------------------------------------- labels

const HEX_RE = /^#[0-9a-f]{3,8}$/i;

/**
 * List endpoints return label objects (`with_labels_details`); the single-item
 * endpoints return plain names. Normalize both to `{ name, color }`, filling
 * colors in from the project's label list.
 */
export function normalizeLabels(labels) {
  const byName = new Map(state.labels.map((l) => [l.name, l.color]));
  return (labels || []).map((l) => {
    if (typeof l === "string") return { name: l, color: byName.get(l) || "" };
    return { name: l.name, color: l.color || byName.get(l.name) || "" };
  });
}

export function labelsHtml(labels) {
  return normalizeLabels(labels)
    .map(({ name, color }) => {
      const style = HEX_RE.test(color) ? ` style="--label-color:${color}"` : "";
      return `<span class="label"${style}>${escapeHtml(name)}</span>`;
    })
    .join("");
}

// ---------------------------------------------------------------- state

function stateInfo(item) {
  const s = String(item.state || "").toLowerCase();
  if (isMR()) {
    if (item.draft || item.work_in_progress) return { cls: "is-muted", label: "Draft", icon: icons.ICON_MR };
    if (s === "merged") return { cls: "is-merged", label: "Merged", icon: icons.ICON_MR };
    if (s === "closed") return { cls: "is-closed", label: "Closed", icon: icons.ICON_MR };
    if (s === "locked") return { cls: "is-muted", label: "Locked", icon: icons.ICON_MR };
    return { cls: "is-open", label: "Open", icon: icons.ICON_MR };
  }
  if (s === "closed") return { cls: "is-closed", label: "Closed", icon: icons.ICON_ISSUE_CLOSED };
  return { cls: "is-open", label: "Open", icon: icons.ICON_ISSUE_OPEN };
}

export function statePill(item) {
  const si = stateInfo(item);
  return `<span class="pill ${si.cls}"><span class="pill__dot"></span>${si.label}</span>`;
}

export const isOpen = (item) => String(item?.state || "").toLowerCase() === "opened";

// -------------------------------------------------------------- pipeline

// A pipeline has more outcomes than a pass/fail rollup, so each status maps to
// its own glyph and tone rather than being squeezed into three buckets.
const PIPELINE_STATUS = {
  success: { cls: "pass", glyph: "✓", label: "passed" },
  failed: { cls: "fail", glyph: "✕", label: "failed" },
  running: { cls: "running", glyph: "●", label: "running" },
  pending: { cls: "pending", glyph: "●", label: "pending" },
  created: { cls: "pending", glyph: "●", label: "created" },
  preparing: { cls: "pending", glyph: "●", label: "preparing" },
  waiting_for_resource: { cls: "pending", glyph: "●", label: "waiting for resource" },
  scheduled: { cls: "pending", glyph: "●", label: "scheduled" },
  manual: { cls: "warn", glyph: "▮", label: "waiting for manual action" },
  canceled: { cls: "warn", glyph: "⊘", label: "canceled" },
  skipped: { cls: "warn", glyph: "⊘", label: "skipped" },
};

export function pipelineBadge(pipeline) {
  if (!pipeline?.status) return "";
  const info = PIPELINE_STATUS[pipeline.status] || { cls: "warn", glyph: "●", label: pipeline.status };
  const url = pipeline.web_url ? ` data-url="${escapeHtml(pipeline.web_url)}"` : "";
  const link = pipeline.web_url ? " checks--link" : "";
  return `<span class="checks checks--${info.cls}${link}"${url}>${info.glyph} Pipeline ${escapeHtml(info.label)}</span>`;
}

// Why GitLab is refusing to merge. Only the statuses a user can act on get a
// sentence; anything else falls back to the raw value, humanized.
const MERGE_BLOCKERS = {
  blocked_status: "Blocked by another merge request.",
  broken_status: "The source branch cannot be merged cleanly.",
  checking: "GitLab is still checking mergeability.",
  ci_must_pass: "The pipeline must pass first.",
  ci_still_running: "The pipeline is still running.",
  conflict: "The branch has conflicts with the target.",
  discussions_not_resolved: "Some discussions are unresolved.",
  draft_status: "This merge request is a draft.",
  external_status_checks: "External status checks have not passed.",
  jira_association_missing: "A Jira issue must be referenced.",
  need_rebase: "The source branch needs a rebase.",
  not_approved: "It still needs approvals.",
  not_open: "It is not open.",
  requested_changes: "A reviewer has requested changes.",
  status_checks_must_pass: "Status checks must pass first.",
  unchecked: "GitLab has not checked mergeability yet.",
};

export function mergeBlockedText(item) {
  const status = item.detailed_merge_status;
  if (!status || status === "mergeable" || status === "can_be_merged") return "";
  return MERGE_BLOCKERS[status] || `${String(status).replace(/_/g, " ")}.`;
}

// ------------------------------------------------------------- skeletons

export function renderLoading() {
  content.innerHTML = Array.from({ length: 7 })
    .map(() => `
      <div class="skeleton-row">
        <div style="flex:1;display:flex;flex-direction:column;gap:var(--s3)">
          <div class="skeleton-bar"></div>
          <div class="skeleton-bar"></div>
        </div>
      </div>`)
    .join("");
}

export function renderDetailLoading() {
  content.innerHTML = `
    <div class="detail">
      <div class="detail__toolbar">
        <div class="skeleton-bar" style="width:60px"></div>
        <div class="skeleton-dot"></div>
      </div>
      <div class="detail__hero">
        <div class="skeleton-dot" style="width:64px;height:20px;border-radius:var(--radius-pill)"></div>
        <div class="skeleton-bar" style="width:85%;height:18px"></div>
        <div class="detail__byline">
          <div class="skeleton-dot" style="width:var(--s9);height:var(--s9)"></div>
          <div class="skeleton-bar" style="width:55%"></div>
        </div>
      </div>
      <div class="meta">
        ${Array.from({ length: 3 }).map(() => `
          <div class="meta__row">
            <div class="skeleton-dot" style="width:13px;height:13px"></div>
            <div class="skeleton-bar" style="width:60px"></div>
            <div class="skeleton-bar" style="width:40%"></div>
          </div>`).join("")}
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--s5)">
        ${["100%", "92%", "96%", "70%"].map((w) => `<div class="skeleton-bar" style="width:${w}"></div>`).join("")}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- states

export function renderError(title, detailHtml, withRetry = true) {
  content.innerHTML = `
    <div class="state">
      <div class="state__icon">${icons.ICON_STATE}</div>
      <div class="state__title">${escapeHtml(title)}</div>
      <div class="state__detail">${detailHtml}</div>
      ${withRetry ? `<button class="btn" id="retry">Retry</button>` : ""}
    </div>`;
  document.querySelector("#retry")?.addEventListener("click", () => nav.list());
}

/** glab isn't on PATH — offer the Homebrew install, same as `gh` in the GitHub panel. */
export function renderGlabMissing(onInstall) {
  content.innerHTML = `
    <div class="state">
      <div class="state__icon">${icons.ICON_STATE}</div>
      <div class="state__title">GitLab CLI not found</div>
      <div class="state__detail">The <code>glab</code> CLI is required to use this extension.</div>
      <div class="state__detail" id="install-status" hidden></div>
      <div class="form__actions">
        <button class="btn btn--accent" id="install">Install glab via Homebrew</button>
        <button class="btn" id="learn-more">Learn more</button>
      </div>
    </div>`;
  document.querySelector("#install").addEventListener("click", onInstall);
  document.querySelector("#learn-more").addEventListener("click", () =>
    openUrl("https://gitlab.com/gitlab-org/cli"));
}

/**
 * Signed out of this particular instance. The hostname comes from the git
 * remote, so the command shown is the one that will actually work — which
 * matters most on a self-managed install, where the default host is wrong.
 */
export function renderSignIn(host) {
  const isSaas = host === "gitlab.com";
  content.innerHTML = `
    <div class="state">
      <div class="state__icon">${icons.ICON_STATE}</div>
      <div class="state__title">Not signed in to ${escapeHtml(host || "GitLab")}</div>
      <div class="state__detail">
        Authenticate the <code>glab</code> CLI for this instance, then retry:
        <code class="cmd">glab auth login${isSaas ? "" : ` --hostname ${escapeHtml(host)}`}</code>
      </div>
      ${isSaas ? "" : `<div class="state__detail">Self-managed instances need the <code>--hostname</code> flag once; glab remembers them afterwards.</div>`}
      <button class="btn" id="retry">Retry</button>
    </div>`;
  document.querySelector("#retry").addEventListener("click", () => nav.list());
}

export function renderNotGitLab(host, reason) {
  content.innerHTML = `
    <div class="state">
      <div class="state__icon">${icons.ICON_STATE}</div>
      <div class="state__title">Not a GitLab project</div>
      <div class="state__detail">${escapeHtml(reason || "This project doesn't have a git remote to read a GitLab project from.")}</div>
      ${host ? `<div class="state__detail">Remote host: <code>${escapeHtml(host)}</code></div>` : ""}
      <button class="btn" id="retry">Retry</button>
    </div>`;
  document.querySelector("#retry").addEventListener("click", () => nav.list());
}

// ------------------------------------------------------------------ list

let listItems = [];
let listQuery = "";

function matchesQuery(it, q) {
  if (!q) return true;
  const labels = normalizeLabels(it.labels).map((l) => l.name).join(" ");
  return `${it.title} !${it.iid} #${it.iid} ${userName(it.author)} ${labels}`.toLowerCase().includes(q);
}

/** Applies the "Mine" toggle and the search box, in that order. */
function applyFilters(items) {
  let out = items;
  if (state.mineOnly && state.currentUser) {
    const me = userName(state.currentUser);
    out = out.filter((it) => userName(it.author) === me);
  }
  if (listQuery) out = out.filter((it) => matchesQuery(it, listQuery));
  return out;
}

export function renderList(items) {
  listItems = items;
  listQuery = "";
  const what = thing();
  const mineBtn = isMR()
    ? `<button class="toggle${state.mineOnly ? " is-active" : ""}" id="mine-only" title="Show only my merge requests" aria-pressed="${state.mineOnly}">Mine</button>`
    : "";
  content.innerHTML = `
    <div class="listbar">
      <div class="search">
        <span class="search__icon">${icons.ICON_SEARCH}</span>
        <input class="search__input" id="search" type="text" placeholder="Filter ${escapeHtml(what.toLowerCase())}s…" />
      </div>
      ${mineBtn}
      <button class="btn btn--accent" id="new">+ New ${escapeHtml(what)}</button>
    </div>
    <div class="list" id="list"></div>`;

  document.querySelector("#new").addEventListener("click", () => nav.create());
  document.querySelector("#search").addEventListener("input", (e) => {
    listQuery = e.target.value.trim().toLowerCase();
    renderRows(applyFilters(listItems));
  });
  const mineBtnEl = document.querySelector("#mine-only");
  if (mineBtnEl) {
    mineBtnEl.addEventListener("click", () => {
      state.mineOnly = !state.mineOnly;
      mineBtnEl.classList.toggle("is-active", state.mineOnly);
      mineBtnEl.setAttribute("aria-pressed", state.mineOnly);
      renderRows(applyFilters(listItems));
    });
  }
  renderRows(applyFilters(items));
}

function renderRows(items) {
  const listEl = document.querySelector("#list");
  if (!listEl) return;
  const what = thing().toLowerCase();

  if (!items.length) {
    listEl.innerHTML = `
      <div class="state">
        <div class="state__icon">${icons.ICON_EMPTY}</div>
        <div class="state__title">No ${escapeHtml(what)}s</div>
        <div class="state__detail">${listQuery
          ? `No ${escapeHtml(what)}s match “${escapeHtml(listQuery)}”.`
          : `No ${escapeHtml(what)}s match this filter.`}</div>
      </div>`;
    return;
  }

  const prefix = isMR() ? "!" : "#";
  listEl.innerHTML = items.map((it) => {
    const si = stateInfo(it);
    const labels = labelsHtml(it.labels);
    const author = userName(it.author) ? ` · ${escapeHtml(userName(it.author))}` : "";
    return `
      <div class="issue" data-iid="${escapeHtml(it.iid)}" tabindex="0" role="button">
        <span class="issue__icon ${si.cls}" title="${si.label}">${si.icon}</span>
        <div class="issue__body">
          <div class="issue__title-row">
            <span class="issue__title">${escapeHtml(it.title)}</span>
            ${labels ? `<span class="issue__labels">${labels}</span>` : ""}
          </div>
          <div class="issue__meta"><span class="issue__num">${prefix}${escapeHtml(it.iid)}</span>${author} · updated ${escapeHtml(timeAgo(it.updated_at))}</div>
        </div>
        <span class="issue__chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>
        </span>
      </div>`;
  }).join("");

  listEl.querySelectorAll(".issue").forEach((row) => {
    const iid = row.getAttribute("data-iid");
    row.addEventListener("click", () => nav.detail(iid));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nav.detail(iid); }
    });
  });
}

// ---------------------------------------------------------------- detail

function approvalsText(approvals) {
  if (!approvals) return "";
  const by = (approvals.approved_by || []).map((a) => userName(a.user)).filter(Boolean);
  const required = approvals.approvals_required ?? 0;
  const head = required
    ? `${by.length} of ${required} required`
    : `${by.length} approval${by.length === 1 ? "" : "s"}`;
  return by.length ? `${head} — ${escapeHtml(by.join(", "))}` : head;
}

/**
 * `extras` carries the follow-up requests the detail view makes alongside the
 * item itself: `notes`, and for merge requests `approvals`.
 */
export function renderDetail(item, extras = {}) {
  const { notes = [], approvals = null } = extras;
  const mr = isMR();
  const prefix = mr ? "!" : "#";
  const labels = labelsHtml(item.labels);
  const assignees = (item.assignees || []).map((a) => escapeHtml(userName(a))).join(", ");
  const reviewers = (item.reviewers || []).map((a) => escapeHtml(userName(a))).join(", ");

  const rows = [];
  if (mr && item.source_branch) {
    rows.push(metaRow(icons.ICON_BRANCH, "Branch",
      `<code class="inline">${escapeHtml(item.target_branch || "")} ← ${escapeHtml(item.source_branch)}</code>`));
  }
  if (mr && item.changes_count) {
    rows.push(metaRow(icons.ICON_FILES, "Changes", `${escapeHtml(item.changes_count)} files changed`));
  }
  const pipeline = pipelineBadge(item.head_pipeline || item.pipeline);
  if (pipeline) rows.push(metaRow(icons.ICON_PIPELINE, "Pipeline", pipeline));
  if (mr && approvals) rows.push(metaRow(icons.ICON_APPROVE, "Approvals", approvalsText(approvals)));
  const blocked = mr && isOpen(item) ? mergeBlockedText(item) : "";
  if (blocked) rows.push(metaRow(icons.ICON_STATE, "Blocked", `<span class="blocked">${escapeHtml(blocked)}</span>`));
  if (labels) rows.push(metaRow(icons.ICON_TAG, "Labels", `<span class="issue__labels">${labels}</span>`));
  if (assignees) rows.push(metaRow(icons.ICON_PERSON, "Assignees", assignees));
  if (mr && reviewers) rows.push(metaRow(icons.ICON_PERSON, "Reviewers", reviewers));
  if (item.milestone?.title) rows.push(metaRow(icons.ICON_MILESTONE, "Milestone", escapeHtml(item.milestone.title)));
  if (!mr && item.due_date) rows.push(metaRow(icons.ICON_CLOCK, "Due", escapeHtml(item.due_date)));
  if (!mr && typeof item.weight === "number") rows.push(metaRow(icons.ICON_WEIGHT, "Weight", String(item.weight)));

  const comments = notes.filter((n) => !n.system);
  const commentsHtml = comments.map((n) => `
    <div class="comment">
      ${avatarHtml(n.author)}
      <div class="comment__col">
        <div class="comment__head"><span class="comment__author">${escapeHtml(userName(n.author))}</span> commented ${escapeHtml(timeAgo(n.created_at))}</div>
        <div class="comment__body">${renderMarkdown(n.body)}</div>
      </div>
    </div>`).join("");

  content.innerHTML = `
    <div class="detail">
      <div class="detail__toolbar">
        <button class="detail__back" id="back">${icons.ICON_BACK} Back</button>
        <button class="icon-btn" id="open-ext" title="Open in browser" aria-label="Open in browser">${icons.ICON_OPEN_EXT}</button>
      </div>
      <div id="flash" class="flash" hidden></div>

      <div class="detail__hero">
        <div class="detail__hero-top">${statePill(item)}</div>
        <h1 class="detail__title">${escapeHtml(item.title)}</h1>
        <div class="detail__byline">
          ${avatarHtml(item.author)}
          <span class="detail__byline-text">
            <strong>${escapeHtml(userName(item.author) || "Unknown")}</strong>
            opened this ${escapeHtml(thing(false))} ${item.created_at ? escapeHtml(timeAgo(item.created_at)) : ""}
            <span class="issue__num">· ${prefix}${escapeHtml(item.iid)}</span>
          </span>
        </div>
      </div>

      ${rows.length ? `<div class="meta">${rows.join("")}</div>` : ""}

      <div class="detail__body">${renderMarkdown(item.description)}</div>

      <div class="toolbelt" id="actions"></div>
      <div class="action-panel" id="action-panel"></div>

      ${commentsHtml ? `<div class="detail__comments"><div class="detail__section">Comments (${comments.length})</div>${commentsHtml}</div>` : ""}
    </div>`;

  document.querySelector("#back").addEventListener("click", () => nav.list());
  document.querySelector("#open-ext").addEventListener("click", () => openUrl(item.web_url));
  content.querySelectorAll("a[data-ext]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); openUrl(a.getAttribute("href")); }));
  content.querySelectorAll(".checks--link").forEach((el) =>
    el.addEventListener("click", () => openUrl(el.getAttribute("data-url"))));
}

// ---------------------------------------------------------------- chrome

/** The `host · group/project` label in the panel's sub-header. */
export function setRepoLabel(host, path) {
  if (!path) {
    repoEl.innerHTML = "";
    repoEl.removeAttribute("title");
    return;
  }
  repoEl.innerHTML = `<span class="host">${escapeHtml(host)}</span> ${escapeHtml(path)}`;
  repoEl.title = `${host}/${path}`;
}

export function flash(msg, kind) {
  const el = document.querySelector("#flash");
  if (!el) return;
  el.textContent = msg;
  el.className = `flash flash--${kind}`;
  el.hidden = false;
}

export { content };
