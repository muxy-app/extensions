// One pipeline in full: its jobs, why it failed, and what changed since it
// was last green.

import { nav } from "../state.js";
import { escapeHtml, timeAgo, ellipsize, shortSha } from "../util.js";
import { durationMs, formatDuration, STATUS, STATUS_META, failedJobs } from "../model.js";
import { openUrl } from "../exec.js";
import * as icons from "../icons.js";
import { content, statusIcon, statusPill, wireExternalLinks, messageFor } from "./chrome.js";

function metaRow(icon, key, valueHtml) {
  return `<div class="meta__row"><span class="meta__icon">${icon}</span><span class="meta__key">${key}</span><span class="meta__value">${valueHtml}</span></div>`;
}

function jobRow(job, canRetryJob) {
  const meta = STATUS_META[job.status] || STATUS_META.unknown;
  const time = formatDuration(durationMs(job));
  const note = job.status === STATUS.failed && job.allowFailure
    ? '<span class="job__note">allowed to fail</span>'
    : job.failureReason
      ? `<span class="job__note">${escapeHtml(String(job.failureReason).replace(/_/g, " "))}</span>`
      : "";
  return `
    <div class="job">
      <span class="job__icon st-${meta.cls}">${statusIcon(job.status)}</span>
      <span class="job__name">
        ${job.stage ? `<span class="job__stage">${escapeHtml(job.stage)} / </span>` : ""}${escapeHtml(job.name)}
      </span>
      ${note}
      <span class="job__time">${escapeHtml(time)}</span>
      ${canRetryJob && job.status === STATUS.failed
        ? `<button class="icon-btn" data-retry-job="${escapeHtml(job.id)}" title="Retry this job" aria-label="Retry this job">${icons.ICON_RETRY}</button>`
        : ""}
      ${job.webUrl
        ? `<button class="icon-btn job__open" data-url="${escapeHtml(job.webUrl)}" title="Open job" aria-label="Open job">${icons.ICON_OPEN_EXT}</button>`
        : ""}
    </div>`;
}

function causeHtml(analysis) {
  if (!analysis) return "";
  const cause = analysis.likelyCause;
  const headline = analysis.errors?.[0] || "";
  if (!cause && !headline) return "";
  return `
    <div class="cause">
      <span class="cause__icon">${icons.ICON_TARGET}</span>
      <div class="cause__col">
        ${cause
          ? `<span class="cause__label">Likely cause</span>
             <span class="cause__loc">${escapeHtml(cause.file)}:${cause.line}${cause.column ? `:${cause.column}` : ""}</span>`
          : `<span class="cause__label">Reported error</span>`}
        ${headline ? `<span class="cause__text">${escapeHtml(ellipsize(headline, 240))}</span>` : ""}
      </div>
    </div>`;
}

function logHtml(analysis) {
  if (!analysis?.lines?.length) return "";
  const lines = analysis.lines
    .map((l) => `<div class="logbox__line${/error|fail|✕/i.test(l) ? " logbox__line--err" : ""}">${escapeHtml(l)}</div>`)
    .join("");
  return `
    <details class="log-details">
      <summary class="detail__section" style="cursor:pointer">Failure log excerpt</summary>
      <div class="logbox">${lines}</div>
    </details>`;
}

function sinceGreenHtml(sinceGreen) {
  if (!sinceGreen) return "";
  const { baseline, commits, reason } = sinceGreen;
  if (reason) {
    return `<div><div class="detail__section">Since the last green pipeline</div><div class="hint">${escapeHtml(reason)}</div></div>`;
  }
  if (!commits?.length) return "";
  return `
    <div>
      <div class="detail__section">
        ${commits.length} commit${commits.length === 1 ? "" : "s"} since ${escapeHtml(baseline.number || shortSha(baseline.sha))} was green
      </div>
      <div class="commits">
        ${commits.map((c) => `
          <div class="commit">
            <span class="commit__hash">${escapeHtml(c.hash)}</span>
            <span class="commit__subject">${escapeHtml(c.subject || "")}</span>
            <span class="commit__author">${escapeHtml(c.author || "")}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

/**
 * `model` is everything the controller gathered:
 * `{ run, capabilities, analysis, sinceGreen, logError, onRetry, onCancel }`.
 */
export function renderDetail(model) {
  const { run, capabilities, analysis, sinceGreen, logError } = model;
  const failed = failedJobs(run);
  const duration = formatDuration(durationMs(run));
  const active = run.status === STATUS.running || run.status === STATUS.queued;

  const rows = [];
  if (run.branch) rows.push(metaRow(icons.ICON_BRANCH, "Branch", `<code class="inline">${escapeHtml(run.branch)}</code>`));
  if (run.sha) rows.push(metaRow(icons.ICON_COMMIT, "Commit", `<code class="inline">${escapeHtml(shortSha(run.sha))}</code>`));
  if (duration) rows.push(metaRow(icons.ICON_CLOCK, "Duration", escapeHtml(duration)));
  if (run.event) rows.push(metaRow(icons.ICON_LOG, "Trigger", escapeHtml(run.event)));
  if (analysis?.failures) {
    rows.push(metaRow(icons.ICON_TARGET, "Failures", `<span class="st-failed">${analysis.failures} reported</span>`));
  }

  const actions = [];
  if (capabilities.retry && failed.length) {
    actions.push(`<button class="btn btn--accent" data-act="retry-failed">Retry failed jobs</button>`);
  }
  if (capabilities.retry && !failed.length && !active) {
    actions.push(`<button class="btn" data-act="retry-all">Re-run</button>`);
  }
  if (capabilities.cancel && active) {
    actions.push(`<button class="btn btn--danger" data-act="cancel">Cancel</button>`);
  }

  content.innerHTML = `
    <div class="detail">
      <div class="detail__toolbar">
        <button class="detail__back" id="back">${icons.ICON_BACK} Back</button>
        ${run.webUrl
          ? `<button class="icon-btn" data-url="${escapeHtml(run.webUrl)}" title="Open in browser" aria-label="Open in browser">${icons.ICON_OPEN_EXT}</button>`
          : ""}
      </div>
      <div id="flash" class="flash" hidden></div>

      <div class="detail__hero">
        <div class="detail__hero-top">
          ${statusPill(run.status)}
          <span class="detail__stats">${escapeHtml(run.sourceLabel)}${run.number ? ` · ${escapeHtml(run.number)}` : ""}</span>
        </div>
        <h1 class="detail__title">${escapeHtml(run.title || run.workflow || "Pipeline")}</h1>
        <div class="detail__stats">
          ${escapeHtml(run.workflow || "")}
          ${run.finishedAt || run.startedAt ? ` · ${escapeHtml(timeAgo(run.finishedAt || run.startedAt))}` : ""}
        </div>
      </div>

      ${rows.length ? `<div class="meta">${rows.join("")}</div>` : ""}
      ${causeHtml(analysis)}

      ${run.jobs?.length
        ? `<div><div class="detail__section">Jobs (${run.jobs.length})</div>
             <div class="jobs">${run.jobs.map((j) => jobRow(j, capabilities.retry)).join("")}</div></div>`
        : capabilities.jobs
          ? `<div class="hint">This pipeline reported no jobs.</div>`
          : `<div class="hint">This source reports build status only — it has no per-job breakdown.</div>`}

      ${logError ? `<div class="hint">Log unavailable — ${escapeHtml(messageFor(logError))}</div>` : logHtml(analysis)}
      ${sinceGreenHtml(sinceGreen)}

      ${actions.length ? `<div class="toolbelt"><div class="toolbelt__primary">${actions.join("")}</div></div>` : ""}
    </div>`;

  document.querySelector("#back").addEventListener("click", () => nav.runs());
  wireExternalLinks(content, openUrl);

  content.querySelectorAll("[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const act = btn.getAttribute("data-act");
      if (act === "cancel") return model.onCancel();
      model.onRetry({ failedOnly: act === "retry-failed" });
    }));

  content.querySelectorAll("[data-retry-job]").forEach((btn) =>
    btn.addEventListener("click", () => model.onRetry({ jobId: btn.getAttribute("data-retry-job") })));
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
      </div>
      <div class="meta">
        ${Array.from({ length: 3 }).map(() => `
          <div class="meta__row">
            <div class="skeleton-dot" style="width:13px;height:13px"></div>
            <div class="skeleton-bar" style="width:60px"></div>
            <div class="skeleton-bar" style="width:40%"></div>
          </div>`).join("")}
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--s4)">
        ${["100%", "92%", "96%"].map((w) => `<div class="skeleton-bar" style="width:${w}"></div>`).join("")}
      </div>
    </div>`;
}
