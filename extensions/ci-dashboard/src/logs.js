// Turning a raw CI log into the two things worth showing in a narrow panel:
// a short excerpt of what actually failed, and a best guess at the source
// location to open. All pure functions — the provider fetches the text.

// CSI sequences and OSC strings. The leading ESC is required — without it
// this would also eat GitHub's own `##[error]` markers.
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
const BOM_RE = /^﻿/;
const ISO_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s?/;

export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI_RE, "");
}

/**
 * `gh run view --log-failed` emits `<job>\t<step>\t<ISO timestamp> <text>`.
 * GitLab job traces are plain text. This normalizes both into
 * `{ job, step, text }` rows with the timestamp and escapes removed.
 */
export function parseLogLines(raw) {
  const out = [];
  for (const line of stripAnsi(raw).split("\n")) {
    const clean = line.replace(BOM_RE, "").replace(/\r$/, "");
    if (!clean.trim()) continue;
    const parts = clean.split("\t");
    if (parts.length >= 3) {
      out.push({
        job: parts[0],
        step: parts[1],
        text: parts.slice(2).join("\t").replace(BOM_RE, "").replace(ISO_PREFIX_RE, ""),
      });
    } else {
      out.push({ job: "", step: "", text: clean.replace(ISO_PREFIX_RE, "") });
    }
  }
  return out;
}

// GitHub workflow commands. `##[error]` is the strongest failure signal there
// is; the group markers are pure noise.
const ERROR_MARKER_RE = /^##\[error\]/;
const NOISE_RE = /^(##\[(group|endgroup|debug|notice|command)\]|env:|shell:|with:|\s*$)/;

const stripMarker = (text) => text.replace(/^##\[[a-z]+\]/, "").trim();

/** Lines GitHub explicitly marked as errors, in order. */
export function errorLines(rows) {
  return rows.filter((r) => ERROR_MARKER_RE.test(r.text)).map((r) => stripMarker(r.text));
}

/**
 * A bounded excerpt of the interesting part of a log. Prefers the window
 * around the first explicit error marker; falls back to the tail, because a
 * failing command's own output is almost always the last thing it printed.
 */
export function excerpt(rows, { max = 14, lead = 4 } = {}) {
  const meaningful = rows.filter((r) => !NOISE_RE.test(r.text));
  if (!meaningful.length) return [];
  const text = (r) => stripMarker(r.text);

  // A short log fits whole — no point trimming context off something that
  // already fits, which would drop the failing test's own name.
  if (meaningful.length <= max) return meaningful.map(text);

  const firstError = meaningful.findIndex((r) => ERROR_MARKER_RE.test(r.text));
  if (firstError >= 0) {
    // Never start so late that the window runs past the end of the log.
    const start = Math.max(0, Math.min(firstError - lead, meaningful.length - max));
    return meaningful.slice(start, start + max).map(text);
  }
  return meaningful.slice(-max).map(text);
}

// Source-location patterns, most specific first. Each must capture file and
// line; column is optional.
const LOCATION_PATTERNS = [
  /\bat [^(]*\(([^):\s]+):(\d+):(\d+)\)/, // node stack frame
  /^\s*-->\s+([^\s:]+):(\d+):(\d+)/, // rust
  /\bFile "([^"]+)", line (\d+)/, // python
  /\b([\w./\\@-]+\.[a-zA-Z]{1,5}):(\d+):(\d+)/, // file.ext:line:col
  /\b([\w./\\@-]+\.[a-zA-Z]{1,5}):(\d+)\b/, // file.ext:line
];

// Extensions worth pointing a developer at. Keeps timestamps, URLs, and
// version strings from being mistaken for source locations.
const SOURCE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|swift|kt|java|go|rs|rb|py|php|cs|c|h|cpp|hpp|m|mm|scala|sh|bash|vue|svelte|sql|yml|yaml|4dm)$/i;
const VENDOR_RE = /(^|\/)(node_modules|vendor|\.venv|site-packages|dist|build|target)\//;

/**
 * Best guess at the source location that caused a failure: the first plausible
 * `file:line` in the excerpt, preferring lines GitHub flagged as errors and
 * skipping vendored paths.
 */
export function likelyCause(rows) {
  const flagged = rows.filter((r) => ERROR_MARKER_RE.test(r.text));
  const ordered = [...flagged, ...rows];

  for (const row of ordered) {
    const text = stripMarker(row.text);
    for (const pattern of LOCATION_PATTERNS) {
      const m = text.match(pattern);
      if (!m) continue;
      const file = m[1];
      if (!SOURCE_EXT_RE.test(file)) continue;
      if (VENDOR_RE.test(file)) continue;
      return {
        file,
        line: Number(m[2]),
        column: m[3] ? Number(m[3]) : null,
        text: text.slice(0, 300),
      };
    }
  }
  return null;
}

const COUNT_PATTERNS = [
  /Tests?:\s+(\d+)\s+failed/i,
  /(\d+)\s+(?:tests?\s+)?fail(?:ing|ed|ures?)\b/i,
  /failures?:\s*(\d+)/i,
];

/** "14 failures" for a job summary line, when the log states a count. */
export function failureCount(rows) {
  for (const row of rows) {
    const text = stripMarker(row.text);
    for (const pattern of COUNT_PATTERNS) {
      const m = text.match(pattern);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return null;
}

/**
 * One call from a raw log to everything the detail view renders.
 * `job` narrows a multi-job GitHub log down to a single job's rows.
 */
export function analyze(raw, { job = "" } = {}) {
  const all = parseLogLines(raw);
  const rows = job ? all.filter((r) => !r.job || r.job === job) : all;
  const scoped = rows.length ? rows : all;
  return {
    lines: excerpt(scoped),
    likelyCause: likelyCause(scoped),
    failures: failureCount(scoped),
    errors: errorLines(scoped),
  };
}
