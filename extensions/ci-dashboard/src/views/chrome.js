// Render helpers shared by every view: status glyphs, skeletons, error states.

import { escapeHtml } from "../util.js";
import { STATUS_META } from "../model.js";
import * as icons from "../icons.js";
import { nav } from "../state.js";

export const content = document.querySelector("#content");

export const statusMeta = (status) => STATUS_META[status] || STATUS_META.unknown;

/** The status glyph, colored by status. */
export function statusIcon(status, extraClass = "") {
  const cls = `st-${statusMeta(status).cls}`;
  return `<span class="${extraClass} ${cls}">${icons.STATUS_ICONS[status] || icons.ICON_UNKNOWN}</span>`;
}

export function statusPill(status, label) {
  const meta = statusMeta(status);
  return `<span class="pill st-${meta.cls}"><span class="pill__dot pulse"></span>${escapeHtml(label || meta.label)}</span>`;
}

export function renderLoading(rows = 6) {
  content.innerHTML = Array.from({ length: rows })
    .map(() => `
      <div class="skeleton-row">
        <div style="flex:1;display:flex;flex-direction:column;gap:var(--s3)">
          <div class="skeleton-bar"></div>
          <div class="skeleton-bar"></div>
        </div>
      </div>`)
    .join("");
}

export function renderEmpty(title, detailHtml, actionHtml = "") {
  content.innerHTML = `
    <div class="state">
      <div class="state__icon">${icons.ICON_EMPTY}</div>
      <div class="state__title">${escapeHtml(title)}</div>
      <div class="state__detail">${detailHtml}</div>
      ${actionHtml}
    </div>`;
}

export function renderError(title, detailHtml, { retry = true } = {}) {
  content.innerHTML = `
    <div class="state">
      <div class="state__icon">${icons.ICON_STATE}</div>
      <div class="state__title">${escapeHtml(title)}</div>
      <div class="state__detail">${detailHtml}</div>
      ${retry ? `<button class="btn" id="retry">Retry</button>` : ""}
    </div>`;
  document.querySelector("#retry")?.addEventListener("click", () => nav.reload());
}

/**
 * The per-source failure strip. Rendered above whatever data did load, because
 * one broken source must never replace the whole view with an error screen.
 */
export function sourceErrorsHtml(errors) {
  if (!errors?.length) return "";
  return errors.map((e) => `
    <div class="source-error">
      <span class="source-error__icon">${icons.ICON_STATE}</span>
      <span class="source-error__text"><strong>${escapeHtml(e.label)}</strong> — ${escapeHtml(messageFor(e.error))}</span>
    </div>`).join("");
}

/** Turns a provider error into one actionable sentence. */
export function messageFor(error) {
  const kind = error?.kind;
  const raw = (error?.message || String(error || "")).trim();
  if (kind === "missing") {
    return `${raw.includes("glab") ? "glab" : raw.includes("gh") ? "gh" : "The required CLI"} is not installed or not on PATH.`;
  }
  if (kind === "auth") return `Not authenticated — ${firstLine(raw)}`;
  return firstLine(raw);
}

function firstLine(text) {
  const line = String(text).split("\n").map((l) => l.trim()).filter(Boolean)[0] || "Request failed.";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

/** Wires every `[data-url]` element in the current view to open in a browser. */
export function wireExternalLinks(root, openUrl) {
  root.querySelectorAll("[data-url]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openUrl(el.getAttribute("data-url"));
    }));
}

export function flash(msg, kind) {
  const el = document.querySelector("#flash");
  if (!el) return;
  el.textContent = msg;
  el.className = `flash flash--${kind}`;
  el.hidden = false;
}
