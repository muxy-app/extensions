// github — Muxy tab extension for viewing/operating on GitHub Issues / Pull Requests.
// Calls the `gh` CLI via muxy.exec. The project selector lets you switch the
// target repository. Write operations also go through gh.

const content = document.querySelector("#content");
const repoEl = document.querySelector("#repo");
const refreshBtn = document.querySelector("#refresh");
const filterEl = document.querySelector("#state-filter");
const projectEl = document.querySelector("#project");
const modeEl = document.querySelector("#mode-switch");

let mode = "issues"; // issues | prs
let currentState = "open"; // open | closed | all
let currentCwd = ""; // Path of the selected project (empty = active project)
let currentItem = null; // Item currently shown in detail view
let loading = false;

const LIST_FIELDS = {
  issues: "number,title,state,author,labels,updatedAt,url",
  prs: "number,title,state,author,labels,updatedAt,url,isDraft",
};
const DETAIL_FIELDS = {
  issues: "number,title,state,author,labels,assignees,milestone,body,createdAt,updatedAt,url,comments",
  prs: "number,title,state,author,labels,assignees,body,createdAt,updatedAt,url,isDraft,additions,deletions,changedFiles,headRefName,baseRefName,comments,reviews,mergeable,statusCheckRollup",
};

const CHECK_FAIL_STATES = ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"];
const CHECK_PASS_STATES = ["SUCCESS", "NEUTRAL", "SKIPPED"];

/** Summarizes a PR's statusCheckRollup into a single pass/fail/pending pill. */
function checksBadge(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return "";
  let pass = 0, fail = 0, pending = 0;
  for (const c of rollup) {
    const s = String(c.conclusion || c.state || "").toUpperCase();
    if (CHECK_FAIL_STATES.includes(s)) fail++;
    else if (CHECK_PASS_STATES.includes(s)) pass++;
    else pending++;
  }
  const total = rollup.length;
  if (fail) return `<span class="checks checks--fail">✕ ${fail}/${total} checks failing</span>`;
  if (pending) return `<span class="checks checks--pending">● ${pending}/${total} checks pending</span>`;
  return `<span class="checks checks--pass">✓ ${total} checks passed</span>`;
}

const noun = () => (mode === "prs" ? "pr" : "issue");

/** Wrapper around muxy.exec. If cwd is given, runs in that directory. */
async function run(argv, cwd = currentCwd) {
  if (!window.muxy || typeof window.muxy.exec !== "function") {
    throw new Error("muxy.exec is unavailable (requires the commands:exec permission).");
  }
  const res = cwd
    ? await window.muxy.exec(argv, { cwd })
    : await window.muxy.exec(argv);
  return {
    stdout: res?.stdout ?? "",
    stderr: res?.stderr ?? "",
    code: res?.exitCode ?? res?.code ?? 0,
  };
}

// ---------------------------------------------------------------- utilities

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const units = [[60, "s"], [60, "m"], [24, "h"], [30, "d"], [12, "mo"], [Infinity, "y"]];
  let v = sec;
  for (const [step, label] of units) {
    if (v < step) return `${v}${label} ago`;
    v = Math.floor(v / step);
  }
  return "";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

const ICON_OPEN = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3.25"/><circle cx="8" cy="8" r="6.25"/></svg>`;
const ICON_CLOSED = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.25"/><path d="M5.5 8l1.75 1.75L11 6"/></svg>`;
const ICON_PR = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><path d="M4 5.5v5M12 10.5V8a3 3 0 0 0-3-3H6.5M8.5 3.5L6 5l2.5 1.5"/></svg>`;

function stateInfo(item) {
  const s = String(item.state || "").toUpperCase();
  if (mode === "prs") {
    if (item.isDraft) return { cls: "is-muted", label: "Draft", icon: ICON_PR };
    if (s === "MERGED") return { cls: "is-merged", label: "Merged", icon: ICON_PR };
    if (s === "CLOSED") return { cls: "is-closed", label: "Closed", icon: ICON_PR };
    return { cls: "is-open", label: "Open", icon: ICON_PR };
  }
  if (s === "CLOSED") return { cls: "is-closed", label: "Closed", icon: ICON_CLOSED };
  return { cls: "is-open", label: "Open", icon: ICON_OPEN };
}

/** HTML for the state pill (dot + label). */
function statePill(item) {
  const si = stateInfo(item);
  return `<span class="pill ${si.cls}"><span class="pill__dot"></span>${si.label}</span>`;
}

const isOpen = (item) => String(item.state || "").toUpperCase() === "OPEN";

// ----------------------------------------------------------------- rendering

function renderLoading() {
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

function renderDetailLoading() {
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

const STATE_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>`;

function renderError(title, detailHtml, withRetry = true) {
  content.innerHTML = `
    <div class="state">
      <div class="state__icon">${STATE_ICON}</div>
      <div class="state__title">${escapeHtml(title)}</div>
      <div class="state__detail">${detailHtml}</div>
      ${withRetry ? `<button class="btn" id="retry">Retry</button>` : ""}
    </div>`;
  const retry = document.querySelector("#retry");
  if (retry) retry.addEventListener("click", loadList);
}

function labelsHtml(labels) {
  return (labels || []).map((l) => {
    const style = l.color ? ` style="--label-color:#${escapeHtml(l.color)}"` : "";
    return `<span class="label"${style}>${escapeHtml(l.name)}</span>`;
  }).join("");
}

const SEARCH_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M13 13l-2.6-2.6"/></svg>`;

let listItems = [];
let listQuery = "";

function matchesQuery(it, q) {
  if (!q) return true;
  const hay = `${it.title} #${it.number} ${it.author?.login || ""} ${(it.labels || []).map((l) => l.name).join(" ")}`.toLowerCase();
  return hay.includes(q);
}

function renderList(items) {
  listItems = items;
  listQuery = "";
  const what = mode === "prs" ? "Pull Request" : "Issue";
  const toolbar = `
    <div class="listbar">
      <div class="search">
        <span class="search__icon">${SEARCH_ICON}</span>
        <input class="search__input" id="search" type="text" placeholder="Filter ${what.toLowerCase()}s…" />
      </div>
      <button class="btn btn--accent" id="new">+ New ${what}</button>
    </div>`;
  content.innerHTML = `${toolbar}<div class="list" id="list"></div>`;
  wireNewButton();
  document.querySelector("#search").addEventListener("input", (e) => {
    listQuery = e.target.value.trim().toLowerCase();
    renderRows(listItems.filter((it) => matchesQuery(it, listQuery)));
  });
  renderRows(items);
}

function renderRows(items) {
  const listEl = document.querySelector("#list");
  if (!listEl) return;
  const what = mode === "prs" ? "Pull Request" : "Issue";
  if (!items.length) {
    listEl.innerHTML = `
      <div class="state">
        <div class="state__icon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/></svg>
        </div>
        <div class="state__title">No ${what.toLowerCase()}s</div>
        <div class="state__detail">${listQuery ? `No ${what.toLowerCase()}s match “${escapeHtml(listQuery)}”.` : `No ${what.toLowerCase()}s match this filter.`}</div>
      </div>`;
    return;
  }
  listEl.innerHTML = items.map((it) => {
    const si = stateInfo(it);
    const labels = labelsHtml(it.labels);
    const author = it.author?.login ? ` · ${escapeHtml(it.author.login)}` : "";
    return `
      <div class="issue" data-num="${escapeHtml(it.number)}" tabindex="0" role="button">
        <span class="issue__icon ${si.cls}" title="${si.label}">${si.icon}</span>
        <div class="issue__body">
          <div class="issue__title-row">
            <span class="issue__title">${escapeHtml(it.title)}</span>
            ${labels ? `<span class="issue__labels">${labels}</span>` : ""}
          </div>
          <div class="issue__meta"><span class="issue__num">#${escapeHtml(it.number)}</span>${author} · updated ${escapeHtml(timeAgo(it.updatedAt))}</div>
        </div>
        <span class="issue__chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>
        </span>
      </div>`;
  }).join("");

  listEl.querySelectorAll(".issue").forEach((row) => {
    const num = row.getAttribute("data-num");
    row.addEventListener("click", () => loadDetail(num));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); loadDetail(num); }
    });
  });
}

/** Minimal, safe Markdown rendering. */
/** Inline-level formatting: code spans, bold, links. Input is already HTML-escaped. */
function renderInline(s) {
  let t = s.replace(/`([^`\n]+)`/g, `<code class="inline">$1</code>`);
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2" data-ext="1">$1</a>`);
  return t;
}

/** Minimal, safe Markdown rendering — headers, bullet/numbered lists, paragraphs, code blocks. */
function renderMarkdown(md) {
  if (!md || !md.trim()) return `<p class="detail__empty">No description.</p>`;

  const codeBlocks = [];
  let escaped = escapeHtml(md).replace(/```([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(`<pre class="code"><code>${code.replace(/^\n/, "")}</code></pre>`);
    return ` CODE${codeBlocks.length - 1} `;
  });

  const ulRe = /^\s*[-*・]\s+(.*)$/;
  const olRe = /^\s*\d+[.)]\s+(.*)$/;
  const hRe = /^(#{1,6})\s+(.+)$/;

  const out = [];
  let para = [];
  let list = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.join("<br>")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };

  for (const line of escaped.split("\n")) {
    if (!line.trim()) { flushPara(); closeList(); continue; }
    const h = line.match(hRe);
    if (h) {
      flushPara(); closeList();
      out.push(`<div class="md-h md-h${h[1].length}">${renderInline(h[2])}</div>`);
      continue;
    }
    const ul = line.match(ulRe);
    const ol = !ul && line.match(olRe);
    if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      if (list !== type) { closeList(); out.push(`<${type} class="md-list">`); list = type; }
      out.push(`<li>${renderInline((ul || ol)[1])}</li>`);
      continue;
    }
    closeList();
    para.push(renderInline(line));
  }
  flushPara();
  closeList();

  return out.join("").replace(/ CODE(\d+) /g, (_, i) => codeBlocks[Number(i)]);
}

const ICON_OPEN_EXT = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h4v4M13 3L7 9M11 9v3.5A1.5 1.5 0 0 1 9.5 14h-6A1.5 1.5 0 0 1 2 12.5v-6A1.5 1.5 0 0 1 3.5 5H7"/></svg>`;
const ICON_BACK = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg>`;
const ICON_BRANCH = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><path d="M4 5.5v5M12 10.5V8a3 3 0 0 0-3-3H6.5"/></svg>`;
const ICON_FILES = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M9 2v3h3"/></svg>`;
const ICON_TAG = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 2H3.5a1 1 0 0 0-1 1v5a1 1 0 0 0 .29.71l6 6a1 1 0 0 0 1.42 0l5-5a1 1 0 0 0 0-1.42l-6-6A1 1 0 0 0 8.5 2z"/><circle cx="5.5" cy="5.5" r="1"/></svg>`;
const ICON_PERSON = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="5.5" r="2.5"/><path d="M3 14c0-2.76 2.24-4.5 5-4.5s5 1.74 5 4.5"/></svg>`;
const ICON_MILESTONE = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14V2M4 3h6.5L9 5.5 10.5 8H4"/></svg>`;
const ICON_COMMENT = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5h12v8H6.5L3 14.5v-3H2z"/></svg>`;
const ICON_EDIT = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2l3 3-8 8-3.5.5.5-3.5z"/></svg>`;
const ICON_REVIEW = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M5.5 9l1.5 1.5L11 6.5"/></svg>`;
const ICON_EYE = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.75"/></svg>`;
const ICON_DOWNLOAD = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13.5h10"/></svg>`;

function initials(login) {
  return (login || "?").slice(0, 1).toUpperCase();
}

function avatarHtml(login) {
  return `<span class="avatar">${escapeHtml(initials(login))}</span>`;
}

function metaRow(icon, key, valueHtml) {
  return `<div class="meta__row"><span class="meta__icon">${icon}</span><span class="meta__key">${key}</span><span class="meta__value">${valueHtml}</span></div>`;
}

function renderDetail(item) {
  currentItem = item;
  const labels = labelsHtml(item.labels);
  const assignees = (item.assignees || []).map((a) => escapeHtml(a.login)).join(", ");
  const checks = mode === "prs" ? checksBadge(item.statusCheckRollup) : "";

  const metaRows = [];
  if (mode === "prs" && item.headRefName) {
    metaRows.push(metaRow(ICON_BRANCH, "Branch", `<code class="inline">${escapeHtml(item.baseRefName || "")} ← ${escapeHtml(item.headRefName)}</code>`));
  }
  if (mode === "prs" && typeof item.changedFiles === "number") {
    metaRows.push(metaRow(ICON_FILES, "Changes", `${item.changedFiles} files <span class="add">+${item.additions ?? 0}</span> <span class="del">−${item.deletions ?? 0}</span>`));
  }
  if (checks) metaRows.push(metaRow(ICON_REVIEW, "Checks", checks));
  if (labels) metaRows.push(metaRow(ICON_TAG, "Labels", `<span class="issue__labels">${labels}</span>`));
  if (assignees) metaRows.push(metaRow(ICON_PERSON, "Assignees", assignees));
  if (mode === "issues" && item.milestone?.title) {
    metaRows.push(metaRow(ICON_MILESTONE, "Milestone", escapeHtml(item.milestone.title)));
  }

  const comments = (item.comments || []).map((c) => `
    <div class="comment">
      ${avatarHtml(c.author?.login)}
      <div class="comment__col">
        <div class="comment__head"><span class="comment__author">${escapeHtml(c.author?.login || "")}</span> commented ${escapeHtml(timeAgo(c.createdAt))}</div>
        <div class="comment__body">${renderMarkdown(c.body)}</div>
      </div>
    </div>`).join("");

  content.innerHTML = `
    <div class="detail">
      <div class="detail__toolbar">
        <button class="detail__back" id="back">${ICON_BACK} Back</button>
        <button class="icon-btn" id="open-ext" title="Open in browser" aria-label="Open in browser">${ICON_OPEN_EXT}</button>
      </div>
      <div id="flash" class="flash" hidden></div>

      <div class="detail__hero">
        <div class="detail__hero-top">${statePill(item)}</div>
        <h1 class="detail__title">${escapeHtml(item.title)}</h1>
        <div class="detail__byline">
          ${avatarHtml(item.author?.login)}
          <span class="detail__byline-text">
            <strong>${item.author?.login ? escapeHtml(item.author.login) : "Unknown"}</strong>
            opened this ${mode === "prs" ? "pull request" : "issue"} ${item.createdAt ? escapeHtml(timeAgo(item.createdAt)) : ""}
            <span class="issue__num">· #${escapeHtml(item.number)}</span>
          </span>
        </div>
      </div>

      ${metaRows.length ? `<div class="meta">${metaRows.join("")}</div>` : ""}

      <div class="detail__body">${renderMarkdown(item.body)}</div>

      <div class="toolbelt" id="actions"></div>
      <div class="action-panel" id="action-panel"></div>

      ${comments ? `<div class="detail__comments"><div class="detail__section">Comments (${item.comments.length})</div>${comments}</div>` : ""}
    </div>`;

  document.querySelector("#back").addEventListener("click", loadList);
  document.querySelector("#open-ext").addEventListener("click", () => openUrl(item.url));
  content.querySelectorAll("a[data-ext]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); openUrl(a.getAttribute("href")); }));
  renderActions(item);
}

// ------------------------------------------------------------- action buttons

function renderActions(item) {
  const bar = document.querySelector("#actions");
  const open = isOpen(item);
  const icons = [
    { act: "comment", label: "Comment", icon: ICON_COMMENT },
    { act: "edit", label: "Edit", icon: ICON_EDIT },
    { act: "labels", label: "Labels & assignees", icon: ICON_TAG },
  ];
  if (mode === "prs") {
    icons.push({ act: "review", label: "Review", icon: ICON_REVIEW });
    icons.push({ act: "ready", label: item.isDraft ? "Mark ready" : "Convert to draft", icon: ICON_EYE });
    icons.push({ act: "checkout", label: "Checkout locally", icon: ICON_DOWNLOAD });
  }

  const primary = [];
  if (mode === "prs" && open) primary.push({ act: "merge", label: "Merge", cls: "btn--accent" });
  primary.push({
    act: "toggle-state",
    label: open ? "Close" : "Reopen",
    cls: open ? "btn--danger" : "",
  });

  bar.innerHTML = `
    <div class="toolbelt__icons">
      ${icons.map((b) => `<button class="icon-btn" data-act="${b.act}" title="${b.label}" aria-label="${b.label}">${b.icon}</button>`).join("")}
    </div>
    <div class="toolbelt__primary">
      ${primary.map((b) => `<button class="btn ${b.cls || ""}" data-act="${b.act}">${b.label}</button>`).join("")}
    </div>`;
  bar.querySelectorAll("[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => openActionPanel(btn.getAttribute("data-act"))));
}

let openPanelAct = null;

function openActionPanel(act) {
  const panel = document.querySelector("#action-panel");
  if (openPanelAct === act) { panel.innerHTML = ""; openPanelAct = null; return; }
  openPanelAct = act;
  const handlers = {
    comment: panelComment,
    edit: panelEdit,
    labels: panelLabels,
    review: panelReview,
    merge: panelMerge,
    ready: () => actReady(),
    checkout: () => actCheckout(),
    "toggle-state": panelToggleState,
  };
  const h = handlers[act];
  if (h) h(panel);
}

function panelToggleState(panel) {
  const open = isOpen(currentItem);
  const thing = noun() === "pr" ? "pull request" : "issue";
  const label = open ? "Close" : "Reopen";
  panel.innerHTML = `
    <div class="form">
      <div class="detail__row">Are you sure you want to ${open ? "close" : "reopen"} this ${thing}?</div>
      <div class="form__actions">
        <button class="btn ${open ? "btn--danger" : "btn--accent"}" id="ts-confirm">${label}</button>
      </div>
    </div>`;
  panel.querySelector("#ts-confirm").addEventListener("click", () => actToggleState());
}

function panelComment(panel) {
  panel.innerHTML = `
    <div class="form">
      <textarea class="ta" id="c-body" placeholder="Write a comment (Markdown supported)"></textarea>
      <div class="form__actions">
        <button class="btn btn--accent" id="c-submit">Post comment</button>
      </div>
    </div>`;
  document.querySelector("#c-submit").addEventListener("click", async () => {
    const body = document.querySelector("#c-body").value.trim();
    if (!body) return flash("Comment is empty.", "error");
    await runWrite([noun(), "comment", String(currentItem.number), "--body", body], "Comment posted");
  });
}

function panelEdit(panel) {
  panel.innerHTML = `
    <div class="form">
      <input class="inp" id="e-title" placeholder="Title" />
      <textarea class="ta" id="e-body" placeholder="Body (Markdown supported)"></textarea>
      <div class="form__actions">
        <button class="btn btn--accent" id="e-submit">Save</button>
      </div>
    </div>`;
  document.querySelector("#e-title").value = currentItem.title || "";
  document.querySelector("#e-body").value = currentItem.body || "";
  document.querySelector("#e-submit").addEventListener("click", async () => {
    const title = document.querySelector("#e-title").value.trim();
    const body = document.querySelector("#e-body").value;
    if (!title) return flash("Title is empty.", "error");
    await runWrite([noun(), "edit", String(currentItem.number), "--title", title, "--body", body], "Saved");
  });
}

function panelLabels(panel) {
  const labelChips = (currentItem.labels || []).map((l) =>
    `<span class="chip">${escapeHtml(l.name)}<button class="chip__x" data-rm-label="${escapeHtml(l.name)}">×</button></span>`).join("");
  const asgChips = (currentItem.assignees || []).map((a) =>
    `<span class="chip">${escapeHtml(a.login)}<button class="chip__x" data-rm-asg="${escapeHtml(a.login)}">×</button></span>`).join("");
  panel.innerHTML = `
    <div class="form">
      <div class="form__group">
        <div class="form__label">Labels</div>
        <div class="chips">${labelChips || '<span class="detail__empty">None</span>'}</div>
        <div class="form__row">
          <input class="inp" id="l-add" placeholder="Add labels (comma-separated)" />
          <button class="btn" id="l-add-btn">Add</button>
        </div>
      </div>
      <div class="form__group">
        <div class="form__label">Assignees</div>
        <div class="chips">${asgChips || '<span class="detail__empty">None</span>'}</div>
        <div class="form__row">
          <input class="inp" id="a-add" placeholder="Add assignees (comma-separated / @me)" />
          <button class="btn" id="a-add-btn">Add</button>
        </div>
      </div>
    </div>`;
  const num = String(currentItem.number);
  panel.querySelectorAll("[data-rm-label]").forEach((b) => b.addEventListener("click", () =>
    runWrite([noun(), "edit", num, "--remove-label", b.getAttribute("data-rm-label")], "Label removed")));
  panel.querySelectorAll("[data-rm-asg]").forEach((b) => b.addEventListener("click", () =>
    runWrite([noun(), "edit", num, "--remove-assignee", b.getAttribute("data-rm-asg")], "Assignee removed")));
  document.querySelector("#l-add-btn").addEventListener("click", () => {
    const v = document.querySelector("#l-add").value.trim();
    if (!v) return;
    runWrite([noun(), "edit", num, "--add-label", v], "Label added");
  });
  document.querySelector("#a-add-btn").addEventListener("click", () => {
    const v = document.querySelector("#a-add").value.trim();
    if (!v) return;
    runWrite([noun(), "edit", num, "--add-assignee", v], "Assignee added");
  });
}

function panelReview(panel) {
  panel.innerHTML = `
    <div class="form">
      <div class="form__row form__row--wrap">
        <label class="radio"><input type="radio" name="rv" value="--approve" checked> Approve</label>
        <label class="radio"><input type="radio" name="rv" value="--request-changes"> Request changes</label>
        <label class="radio"><input type="radio" name="rv" value="--comment"> Comment</label>
      </div>
      <textarea class="ta" id="rv-body" placeholder="Review comment (optional; required for Request changes / Comment)"></textarea>
      <div class="form__actions">
        <button class="btn btn--accent" id="rv-submit">Submit review</button>
      </div>
    </div>`;
  document.querySelector("#rv-submit").addEventListener("click", async () => {
    const kind = panel.querySelector('input[name="rv"]:checked').value;
    const body = document.querySelector("#rv-body").value.trim();
    if (kind !== "--approve" && !body) return flash("A comment body is required for this review type.", "error");
    const argv = ["pr", "review", String(currentItem.number), kind];
    if (body) argv.push("--body", body);
    await runWrite(argv, "Review submitted");
  });
}

function panelMerge(panel) {
  panel.innerHTML = `
    <div class="form">
      <div class="form__row form__row--wrap">
        <label class="radio"><input type="radio" name="mm" value="--squash" checked> Squash</label>
        <label class="radio"><input type="radio" name="mm" value="--merge"> Merge commit</label>
        <label class="radio"><input type="radio" name="mm" value="--rebase"> Rebase</label>
      </div>
      <label class="check"><input type="checkbox" id="m-del"> Delete branch after merge</label>
      <div class="form__actions">
        <button class="btn btn--accent" id="m-submit">Merge this PR</button>
      </div>
    </div>`;
  document.querySelector("#m-submit").addEventListener("click", async () => {
    const method = panel.querySelector('input[name="mm"]:checked').value;
    const argv = ["pr", "merge", String(currentItem.number), method];
    if (document.querySelector("#m-del").checked) argv.push("--delete-branch");
    await runWrite(argv, "Merged");
  });
}

async function actReady() {
  const num = String(currentItem.number);
  const argv = currentItem.isDraft ? ["pr", "ready", num] : ["pr", "ready", num, "--undo"];
  await runWrite(argv, currentItem.isDraft ? "Marked ready" : "Converted to draft");
}

async function actCheckout() {
  const { code, stderr, stdout } = await run(["gh", "pr", "checkout", String(currentItem.number)]);
  if (code === 0) flash("Checked out locally", "ok");
  else flash((stderr || stdout || "Failed").trim().slice(0, 200), "error");
  document.querySelector("#action-panel").innerHTML = "";
  openPanelAct = null;
}

async function actToggleState() {
  const num = String(currentItem.number);
  const verb = isOpen(currentItem) ? "close" : "reopen";
  await runWrite([noun(), verb, num], verb === "close" ? "Closed" : "Reopened");
}

// --------------------------------------------------------------- gh commands

/** Run a write-type gh command, show the result, and reload the detail view. */
async function runWrite(ghArgs, okMsg) {
  refreshBtn.classList.add("is-spinning");
  try {
    const { code, stderr, stdout } = await run(["gh", ...ghArgs]);
    if (code !== 0) {
      flash((stderr || stdout || "Command failed").trim().slice(0, 240), "error");
      return false;
    }
    await loadDetail(currentItem.number); // Re-render with the latest state
    flash(okMsg, "ok");
    return true;
  } catch (e) {
    flash(e.message || String(e), "error");
    return false;
  } finally {
    refreshBtn.classList.remove("is-spinning");
  }
}

function flash(msg, kind) {
  const el = document.querySelector("#flash");
  if (!el) return;
  el.textContent = msg;
  el.className = `flash flash--${kind}`;
  el.hidden = false;
}

async function openUrl(url) {
  if (!url) return;
  try { await run(["open", url]); }
  catch (e) { console.error("[github] failed to open:", e); }
}

function wireNewButton() {
  const btn = document.querySelector("#new");
  if (btn) btn.addEventListener("click", renderCreate);
}

function renderCreate() {
  const what = mode === "prs" ? "Pull Request" : "Issue";
  content.innerHTML = `
    <div class="detail">
      <button class="detail__back" id="back">← Back to list</button>
      <div id="flash" class="flash" hidden></div>
      <div class="detail__title">New ${what}</div>
      ${mode === "prs" ? `<div class="detail__stats">Created from the current branch (base is the default branch).</div>` : ""}
      <div class="form">
        <input class="inp" id="n-title" placeholder="Title" />
        <textarea class="ta" id="n-body" placeholder="Body (Markdown supported)"></textarea>
        <div class="form__actions">
          <button class="btn btn--accent" id="n-submit">Create</button>
        </div>
      </div>
    </div>`;
  document.querySelector("#back").addEventListener("click", loadList);
  document.querySelector("#n-submit").addEventListener("click", async () => {
    const title = document.querySelector("#n-title").value.trim();
    const body = document.querySelector("#n-body").value;
    if (!title) return flash("Title is empty.", "error");
    refreshBtn.classList.add("is-spinning");
    try {
      const argv = ["gh", noun(), "create", "--title", title, "--body", body];
      const { code, stdout, stderr } = await run(argv);
      if (code !== 0) return flash((stderr || stdout || "Failed to create").trim().slice(0, 240), "error");
      await loadList();
    } catch (e) {
      flash(e.message || String(e), "error");
    } finally {
      refreshBtn.classList.remove("is-spinning");
    }
  });
}

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
  } catch (e) {
    console.warn("[github] failed to fetch project list:", e);
  }
}

async function loadRepoName() {
  try {
    const { stdout, code } = await run(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
    if (code === 0) {
      const name = stdout.trim();
      repoEl.textContent = name;
      repoEl.title = name;
    }
  } catch { /* cosmetic only, ignore */ }
}

async function loadList() {
  openPanelAct = null;
  currentItem = null;
  if (loading) return;
  loading = true;
  refreshBtn.classList.add("is-spinning");
  renderLoading();
  try {
    const argv = ["gh", noun(), "list", "--json", LIST_FIELDS[mode], "--state", currentState, "--limit", "100"];
    const { stdout, stderr, code } = await run(argv);
    if (code !== 0) return handleGhError(stderr || stdout);
    let items;
    try { items = JSON.parse(stdout || "[]"); }
    catch { return renderError("Failed to load", "Could not parse gh output."); }
    renderList(items);
  } catch (e) {
    renderError("An error occurred", escapeHtml(e.message || String(e)));
  } finally {
    loading = false;
    refreshBtn.classList.remove("is-spinning");
  }
}

async function loadDetail(num) {
  openPanelAct = null;
  refreshBtn.classList.add("is-spinning");
  renderDetailLoading();
  try {
    const argv = ["gh", noun(), "view", String(num), "--json", DETAIL_FIELDS[mode]];
    const { stdout, stderr, code } = await run(argv);
    if (code !== 0) return handleGhError(stderr || stdout);
    renderDetail(JSON.parse(stdout));
  } catch (e) {
    renderError("Failed to load detail", escapeHtml(e.message || String(e)));
  } finally {
    refreshBtn.classList.remove("is-spinning");
  }
}

function renderGhMissing() {
  content.innerHTML = `
    <div class="state">
      <div class="state__icon">${STATE_ICON}</div>
      <div class="state__title">GitHub CLI not found</div>
      <div class="state__detail">The <code class="inline">gh</code> CLI is required to use this extension.</div>
      <div class="state__detail" id="gh-install-status" hidden></div>
      <div class="form__actions">
        <button class="btn btn--accent" id="gh-install">Install gh via Homebrew</button>
        <button class="btn" id="gh-learn-more">Learn more</button>
      </div>
    </div>`;
  document.querySelector("#gh-install").addEventListener("click", installGh);
  document.querySelector("#gh-learn-more").addEventListener("click", () => openUrl("https://cli.github.com"));
}

async function installGh() {
  const btn = document.querySelector("#gh-install");
  const status = document.querySelector("#gh-install-status");
  btn.disabled = true;
  btn.textContent = "Installing…";
  status.hidden = false;
  status.textContent = "Running brew install gh — this can take a minute.";
  try {
    const { code, stdout, stderr } = await run(["brew", "install", "gh"]);
    if (code === 0) {
      status.textContent = "Installed. Reloading…";
      return loadList();
    }
    const out = (stderr || stdout || "").toLowerCase();
    status.textContent = out.includes("command not found") || out.includes("no such file")
      ? "Homebrew isn't installed. Install Homebrew from brew.sh first, or install gh manually from cli.github.com."
      : (stderr || stdout || "Installation failed.").trim().slice(0, 300);
  } catch (e) {
    status.textContent = e.message || String(e);
  } finally {
    btn.disabled = false;
    btn.textContent = "Retry install";
  }
}

function handleGhError(msg) {
  const m = (msg || "").toLowerCase();
  if (m.includes("command not found") || m.includes("no such file") || m.includes("executable file not found")) {
    renderGhMissing();
  } else if (m.includes("auth") || m.includes("logged in") || m.includes("authentication")) {
    renderError("Not logged in to GitHub", `Run <code>gh auth login</code> in your terminal.`);
  } else if (m.includes("not a git repository") || m.includes("could not determine") || m.includes("no git remote")) {
    renderError("Not a GitHub repository", "This project doesn't appear to have a GitHub remote configured.");
  } else {
    renderError("Failed to fetch", `<code>${escapeHtml((msg || "").trim().slice(0, 300))}</code>`);
  }
}

// ------------------------------------------------------------------- wiring

modeEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg__btn");
  if (!btn) return;
  const next = btn.getAttribute("data-mode");
  if (next === mode) return;
  mode = next;
  modeEl.querySelectorAll(".seg__btn").forEach((b) => b.classList.toggle("is-active", b === btn));
  loadList();
});

filterEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg__btn");
  if (!btn) return;
  const next = btn.getAttribute("data-state");
  if (next === currentState) return;
  currentState = next;
  filterEl.querySelectorAll(".seg__btn").forEach((b) => b.classList.toggle("is-active", b === btn));
  loadList();
});

projectEl.addEventListener("change", () => {
  currentCwd = projectEl.value;
  loadRepoName();
  loadList();
});

refreshBtn.addEventListener("click", () => { loadRepoName(); loadList(); });

// When the active project changes and the picker is still on "Current project"
// (currentCwd === ""), refresh so the panel tracks the newly focused project.
if (window.muxy?.events?.subscribe) {
  window.muxy.events.subscribe("project.switched", async () => {
    await loadProjects();
    if (!currentCwd) {
      loadRepoName();
      loadList();
    }
  });
}

// --------------------------------------------------------------------- boot
(async () => {
  await loadProjects();
  loadRepoName();
  loadList();
})();
