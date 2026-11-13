// Small helpers shared by the sidebar and the request tab: escaping, theme,
// toasts, the context menu, clipboard, and formatting.
import { icon } from "./icons.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const mx = () => window.muxy;

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const isMac = /Mac/i.test(navigator.platform || navigator.userAgent || "");
export const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);

export function uid() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Date.now().toString(36) + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function debounce(fn, ms) {
  let t = null;
  const run = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
  run.flush = (...args) => {
    if (t == null) return;
    clearTimeout(t);
    t = null;
    fn(...args);
  };
  run.cancel = () => {
    clearTimeout(t);
    t = null;
  };
  run.pending = () => t != null;
  return run;
}

export function initTheme() {
  const m = mx();
  const apply = (theme) => {
    if (!theme?.colorScheme) return;
    document.documentElement.style.colorScheme = theme.colorScheme;
    document.documentElement.dataset.scheme = theme.colorScheme;
  };
  apply(m?.theme);
  m?.onThemeChange?.(apply);
}

// ---------------------------------------------------------------- methods

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function methodClass(method) {
  const m = String(method || "").toUpperCase();
  return METHODS.includes(m) ? `m-${m.toLowerCase()}` : "m-other";
}

export function methodShort(method) {
  const m = String(method || "GET").toUpperCase();
  return { DELETE: "DEL", OPTIONS: "OPT", PATCH: "PATCH" }[m] || (m.length > 5 ? m.slice(0, 4) : m);
}

export function statusClass(status) {
  const s = Number(status) || 0;
  if (s >= 500) return "s5";
  if (s >= 400) return "s4";
  if (s >= 300) return "s3";
  if (s >= 200) return "s2";
  return "s0";
}

// ---------------------------------------------------------------- format

export function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtMs(ms) {
  ms = Number(ms) || 0;
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function relTime(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function utf8Length(s) {
  try {
    return new TextEncoder().encode(String(s ?? "")).length;
  } catch {
    return String(s ?? "").length;
  }
}

// ---------------------------------------------------------------- toasts

function toastHost() {
  let host = $("#toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    host.className = "toasts";
    document.body.append(host);
  }
  return host;
}

export function toast(text, { kind = "ok", timeout = 2600, action = null } = {}) {
  const host = toastHost();
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === "error" ? "alert" : kind === "info" ? "info" : "check")}<span class="toast-text">${esc(text)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ""}`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add("out");
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener("click", (e) => {
    if (action && e.target.closest(".toast-action")) action.run();
    close();
  });
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  if (timeout) setTimeout(close, timeout);
  return { close };
}

export function toastError(e, prefix = "") {
  const msg = e?.message || String(e);
  console.warn("[rest]", prefix ? `${prefix}: ${msg}` : msg);
  toast(prefix ? `${prefix}: ${msg}` : msg, { kind: "error", timeout: 7000 });
}

export async function copyText(text, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand?.("copy");
    } finally {
      ta.remove();
    }
  }
  toast(what);
}

// ---------------------------------------------------------------- dialogs

export async function confirmDialog(opts) {
  try {
    return await mx().dialog.confirm(opts);
  } catch (e) {
    toastError(e);
    return null;
  }
}

export async function promptDialog(opts) {
  try {
    return await mx().dialog.prompt(opts);
  } catch (e) {
    toastError(e);
    return null;
  }
}

export async function pick(opts) {
  try {
    return await mx().modal.open(opts);
  } catch (e) {
    toastError(e);
    return null;
  }
}

// ---------------------------------------------------------------- menu

let menuEl = null;
let menuItems = null;
let menuOnClose = null;

function ensureMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement("div");
  menuEl.className = "menu";
  menuEl.hidden = true;
  document.body.append(menuEl);
  menuEl.addEventListener("click", (e) => {
    const b = e.target.closest(".menu-item");
    if (!b || b.disabled) return;
    const it = menuItems?.[Number(b.dataset.menu)];
    closeMenu();
    it?.run?.();
  });
  menuEl.addEventListener("keydown", (e) => {
    const items = [...menuEl.querySelectorAll(".menu-item:not(:disabled)")];
    const at = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]?.focus({ preventScroll: true });
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  });
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!menuEl.hidden && !menuEl.contains(e.target)) closeMenu();
    },
    true
  );
  window.addEventListener("blur", closeMenu);
  window.addEventListener("resize", closeMenu);
  return menuEl;
}

// items: [{ label, icon, run, danger, disabled, checked, hint, cls } | "-" | { header }]
export function openMenu(items, anchor, { align = "right", onClose = null } = {}) {
  items = (items || []).filter(Boolean);
  if (!items.length) return;
  const el = ensureMenu();
  menuItems = items;
  menuOnClose = onClose;
  const hasChecks = items.some((it) => it && typeof it === "object" && "checked" in it);
  el.innerHTML = items
    .map((it, i) => {
      if (it === "-") return '<div class="menu-sep"></div>';
      if (it.header) return `<div class="menu-header">${esc(it.header)}</div>`;
      const lead = hasChecks && "checked" in it ? (it.checked ? icon("check", "menu-check") : '<span class="menu-check-space"></span>') : icon(it.icon || "");
      return `<button class="menu-item${it.danger ? " danger" : ""}${it.cls ? " " + it.cls : ""}" data-menu="${i}"${it.disabled ? " disabled" : ""}>${lead}<span class="menu-label">${it.html || esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ""}</button>`;
    })
    .join("");
  el.hidden = false;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x;
  let y;
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    x = align === "left" ? r.left : r.right - w;
    y = r.bottom + 4;
    if (y + h > window.innerHeight - 6) y = r.top - h - 4;
  } else {
    x = anchor.x;
    y = anchor.y;
    if (y + h > window.innerHeight - 6) y = anchor.y - h;
  }
  el.style.left = `${Math.max(6, Math.min(x, window.innerWidth - w - 6))}px`;
  el.style.top = `${Math.max(6, Math.min(y, window.innerHeight - h - 6))}px`;
  el.tabIndex = -1;
  el.focus({ preventScroll: true });
}

export function closeMenu() {
  if (!menuEl || menuEl.hidden) return;
  menuEl.hidden = true;
  menuItems = null;
  const cb = menuOnClose;
  menuOnClose = null;
  cb?.();
}

export function menuOpen() {
  return !!menuEl && !menuEl.hidden;
}
