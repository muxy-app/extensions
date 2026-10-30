// The pipelines list — the panel's home view.

import { state, nav } from "../state.js";
import { escapeHtml, timeAgo, ellipsize, shortSha } from "../util.js";
import { durationMs, formatDuration, jobSummary, STATUS_META } from "../model.js";
import { openUrl } from "../exec.js";
import * as icons from "../icons.js";
import { content, statusIcon, sourceErrorsHtml, renderEmpty, wireExternalLinks } from "./chrome.js";

/** "3 ✓  1 ✕" — a compact per-status tally for a run row. */
function tallyHtml(jobs) {
  const counts = jobSummary(jobs);
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => {
      const meta = STATUS_META[status] || STATUS_META.unknown;
      return `<span class="tally__item st-${meta.cls}">${n}${meta.glyph}</span>`;
    });
  return parts.length ? `<span class="tally">${parts.join("")}</span>` : "";
}

function runRow(run) {
  const duration = formatDuration(durationMs(run));
  const when = timeAgo(run.finishedAt || run.startedAt || run.createdAt);
  const meta = [];
  if (run.workflow) meta.push(escapeHtml(ellipsize(run.workflow, 28)));
  if (run.number) meta.push(`<span class="run__branch">${escapeHtml(run.number)}</span>`);
  if (run.branch) meta.push(`<span class="run__branch">${escapeHtml(ellipsize(run.branch, 24))}</span>`);
  if (duration) meta.push(escapeHtml(duration));
  if (when) meta.push(escapeHtml(when));

  return `
    <div class="run" data-run="${escapeHtml(run.id)}" data-source="${escapeHtml(run.source)}" tabindex="0" role="button">
      <span class="run__icon ${`st-${(STATUS_META[run.status] || STATUS_META.unknown).cls}`}">${statusIcon(run.status)}</span>
      <div class="run__body">
        <div class="run__title">${escapeHtml(run.title || run.workflow || "Pipeline")}</div>
        <div class="run__meta">${meta.join('<span class="run__sep">·</span>')}${tallyHtml(run.jobs)}</div>
      </div>
      ${run.webUrl
        ? `<button class="icon-btn" data-url="${escapeHtml(run.webUrl)}" title="Open in browser" aria-label="Open in browser">${icons.ICON_OPEN_EXT}</button>`
        : ""}
      <span class="run__chevron" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>
      </span>
    </div>`;
}

export function renderRuns() {
  const runs = state.runs;
  const errorsHtml = sourceErrorsHtml(state.errors);

  if (!runs.length) {
    if (!state.config.sources.length) return nav.sources();
    const detail = state.branch
      ? `No pipelines on <code>${escapeHtml(state.branch)}</code>. Try “All branches”.`
      : "No pipelines reported by the configured sources yet.";
    content.innerHTML = errorsHtml;
    content.insertAdjacentHTML("beforeend", `
      <div class="state">
        <div class="state__icon">${icons.ICON_EMPTY}</div>
        <div class="state__title">Nothing to show</div>
        <div class="state__detail">${detail}</div>
        <button class="btn" id="open-sources">Configure sources</button>
      </div>`);
    document.querySelector("#open-sources")?.addEventListener("click", () => nav.sources());
    return;
  }

  // Group by source only when more than one is reporting, so the common
  // single-source case stays a flat list.
  const sources = [...new Set(runs.map((r) => r.source))];
  let body;
  if (sources.length > 1) {
    body = sources.map((id) => {
      const group = runs.filter((r) => r.source === id);
      return `<div class="group-head">${escapeHtml(group[0].sourceLabel)}</div>${group.map(runRow).join("")}`;
    }).join("");
  } else {
    body = runs.map(runRow).join("");
  }

  content.innerHTML = `${errorsHtml}<div class="list" id="list">${body}</div>`;
  wireRows();
}

function wireRows() {
  content.querySelectorAll(".run").forEach((row) => {
    const id = row.getAttribute("data-run");
    const source = row.getAttribute("data-source");
    const open = () => nav.detail(source, id);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });
  wireExternalLinks(content, openUrl);
}

export { renderEmpty, shortSha };
