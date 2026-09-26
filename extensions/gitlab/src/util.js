// Small formatting helpers shared by every view.

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function timeAgo(iso) {
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

export function initials(name) {
  return (name || "?").slice(0, 1).toUpperCase();
}

export function avatarHtml(user) {
  return `<span class="avatar">${escapeHtml(initials(user?.username || user?.name))}</span>`;
}

/** "@alice", falling back to the display name when a username is missing. */
export function userName(user) {
  return user?.username || user?.name || "";
}

export function metaRow(icon, key, valueHtml) {
  return `<div class="meta__row"><span class="meta__icon">${icon}</span><span class="meta__key">${key}</span><span class="meta__value">${valueHtml}</span></div>`;
}

/** Splits a comma-separated input into trimmed, non-empty values. */
export function splitList(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
