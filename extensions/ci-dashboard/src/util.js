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

/** Trims a long single-line string in the middle, keeping both ends readable. */
export function ellipsize(text, max = 90) {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) / 2);
  return `${s.slice(0, head)}…${s.slice(s.length - (max - head - 1))}`;
}

export const shortSha = (sha) => String(sha || "").slice(0, 7);
