// Formatting and config normalization, shared by background, popover and
// report. Pure — no muxy.* here.

export const DEFAULT_CONFIG = {
  version: 1,
  mode: "muxy", // 'muxy': count only while Muxy is frontmost; 'machine': any app
  idleSec: 120,
  assumeActiveMin: 10, // degraded mode: assume active this long after an event
  workHours: null, // null | { start: "09:00", end: "18:00" }
  paused: false,
  pomo: {
    focusMin: 25,
    breakMin: 5,
    longBreakMin: 15,
    cadence: 4,
    autoStartBreaks: true,
    autoStartFocus: false,
    notify: true,
  },
};

function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function hhmm(value) {
  return typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value) ? value : null;
}

export function normalizeConfig(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const pomo = src.pomo && typeof src.pomo === "object" ? src.pomo : {};
  const start = hhmm(src.workHours?.start);
  const end = hhmm(src.workHours?.end);
  return {
    version: 1,
    mode: src.mode === "machine" ? "machine" : "muxy",
    idleSec: num(src.idleSec, DEFAULT_CONFIG.idleSec, 30, 3600),
    assumeActiveMin: num(src.assumeActiveMin, DEFAULT_CONFIG.assumeActiveMin, 1, 120),
    workHours: start && end && start !== end ? { start, end } : null,
    paused: src.paused === true,
    pomo: {
      focusMin: num(pomo.focusMin, DEFAULT_CONFIG.pomo.focusMin, 1, 240),
      breakMin: num(pomo.breakMin, DEFAULT_CONFIG.pomo.breakMin, 1, 120),
      longBreakMin: num(pomo.longBreakMin, DEFAULT_CONFIG.pomo.longBreakMin, 1, 240),
      cadence: num(pomo.cadence, DEFAULT_CONFIG.pomo.cadence, 1, 12),
      autoStartBreaks: pomo.autoStartBreaks !== false,
      autoStartFocus: pomo.autoStartFocus === true,
      notify: pomo.notify !== false,
    },
  };
}

// ── local-date helpers ──────────────────────────────────────────────────────
// Day keys are LOCAL date strings; a DST shift changes a day's length but
// never double-counts.

export function dayKey(ts) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function startOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function nextMidnight(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

export function addDays(key, delta) {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + delta).getTime());
}

// Minutes since local midnight for an "HH:MM" string.
export function minutesOf(hhmmStr) {
  const [h, m] = hhmmStr.split(":").map(Number);
  return h * 60 + m;
}

// Split a time span across local midnights → [{ day, seconds }].
export function splitByDay(fromMs, toMs) {
  const out = [];
  let cursor = fromMs;
  while (cursor < toMs) {
    const boundary = Math.min(toMs, nextMidnight(cursor));
    const seconds = (boundary - cursor) / 1000;
    if (seconds > 0) out.push({ day: dayKey(cursor), seconds });
    cursor = boundary;
  }
  return out;
}

// ── durations ───────────────────────────────────────────────────────────────

// "1h 42m", "42m", "0m" — status bar / report totals.
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s - h * 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

// Status-bar countdown: minute granularity, seconds under the final minute.
export function fmtCountdown(msRemaining) {
  const s = Math.max(0, Math.ceil(msRemaining / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.ceil(s / 60)}m`;
}

// Popover countdown: "24:37".
export function fmtClock(msRemaining) {
  const s = Math.max(0, Math.ceil(msRemaining / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function basename(path) {
  if (typeof path !== "string" || !path) return null;
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || null;
}

export function shortID(id) {
  return typeof id === "string" && id ? id.slice(0, 8) : "unknown";
}
