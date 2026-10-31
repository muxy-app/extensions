const UNITS = [
  [60, "s", 1],
  [3600, "m", 60],
  [86400, "h", 3600],
  [604800, "d", 86400],
  [2629800, "w", 604800],
  [31557600, "mo", 2629800],
];

export function relativeTime(iso, now = Date.now()) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return "now";
  for (const [limit, unit, size] of UNITS) {
    if (seconds < limit) return `${Math.floor(seconds / size)}${unit}`;
  }
  return `${Math.floor(seconds / 31557600)}y`;
}

export function absoluteTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
