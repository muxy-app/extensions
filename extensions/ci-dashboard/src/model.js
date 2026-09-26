// The normalized shape every provider maps onto. Nothing above this layer knows
// whether a run came from GitHub Actions, GitLab CI, or a CCTray feed.
//
// Run  { id, source, number, title, workflow, status, branch, sha, event,
//        createdAt, startedAt, finishedAt, durationMs, webUrl, jobs?, actor? }
// Job  { id, name, stage, status, startedAt, finishedAt, durationMs, webUrl,
//        allowFailure }

/** Canonical statuses. Everything a provider reports collapses into one of these. */
export const STATUS = {
  success: "success",
  failed: "failed",
  running: "running",
  queued: "queued",
  canceled: "canceled",
  skipped: "skipped",
  manual: "manual",
  unknown: "unknown",
};

const SUCCESS = ["success", "passed", "ok", "completed", "neutral"];
const FAILED = ["failure", "failed", "error", "exception", "timed_out", "startup_failure", "action_required"];
const RUNNING = ["in_progress", "running", "building", "pending_running", "started"];
const QUEUED = ["queued", "waiting", "waiting_for_resource", "pending", "requested", "created", "preparing", "scheduled"];
const CANCELED = ["cancelled", "canceled", "stale"];
const SKIPPED = ["skipped"];
const MANUAL = ["manual", "action_required_manual"];

/**
 * Maps a provider's own status vocabulary onto {@link STATUS}. `conclusion`
 * wins when present, because GitHub reports `status: "completed"` alongside the
 * conclusion that actually says how it went.
 */
export function normalizeStatus(status, conclusion) {
  const raw = String(conclusion || status || "").toLowerCase().trim();
  if (!raw) return STATUS.unknown;
  if (SUCCESS.includes(raw)) return STATUS.success;
  if (FAILED.includes(raw)) return STATUS.failed;
  if (RUNNING.includes(raw)) return STATUS.running;
  if (QUEUED.includes(raw)) return STATUS.queued;
  if (CANCELED.includes(raw)) return STATUS.canceled;
  if (SKIPPED.includes(raw)) return STATUS.skipped;
  if (MANUAL.includes(raw)) return STATUS.manual;
  return STATUS.unknown;
}

export const isTerminal = (status) =>
  [STATUS.success, STATUS.failed, STATUS.canceled, STATUS.skipped].includes(status);

export const isActive = (status) => status === STATUS.running || status === STATUS.queued;

/** Display metadata per status: CSS modifier, glyph, and label. */
export const STATUS_META = {
  [STATUS.success]: { cls: "success", glyph: "✓", label: "passed" },
  [STATUS.failed]: { cls: "failed", glyph: "✕", label: "failed" },
  [STATUS.running]: { cls: "running", glyph: "●", label: "running" },
  [STATUS.queued]: { cls: "queued", glyph: "◌", label: "queued" },
  [STATUS.canceled]: { cls: "canceled", glyph: "⊘", label: "canceled" },
  [STATUS.skipped]: { cls: "skipped", glyph: "⊘", label: "skipped" },
  [STATUS.manual]: { cls: "manual", glyph: "▮", label: "manual" },
  [STATUS.unknown]: { cls: "unknown", glyph: "?", label: "unknown" },
};

/**
 * Duration in ms, or null when it cannot be established.
 *
 * Only a still-active item measures against now, so a terminal one that never
 * reported a finish time reads as "no duration" rather than growing forever.
 * GitHub also stamps a skipped job's completedAt *before* its startedAt, so a
 * negative span is discarded rather than rendered.
 */
export function durationMs(run) {
  if (typeof run?.durationMs === "number" && run.durationMs >= 0) return run.durationMs;
  // Some feeds publish no timing at all (CCTray reports only when a build last
  // finished). Those say so outright rather than having a duration inferred.
  if (run?.durationKnown === false) return null;

  const start = Date.parse(run?.startedAt || "");
  const finish = Date.parse(run?.finishedAt || "");

  // Both ends known: real elapsed time. GitHub stamps some skipped jobs as
  // completing before they started, so a negative span is discarded.
  if (!Number.isNaN(start) && !Number.isNaN(finish)) return finish >= start ? finish - start : null;

  // Still going: measure against now so the panel ticks upward. A queued run
  // has no start yet, so fall back to when it was created.
  if (isActive(run?.status)) {
    const from = Number.isNaN(start) ? Date.parse(run?.createdAt || "") : start;
    return Number.isNaN(from) ? null : Date.now() - from;
  }

  // Anything else — a finished build that only reported one timestamp, as
  // CCTray does — has no duration to state. Guessing one would invent "0s".
  return null;
}

/** "4m 12s" — compact enough for a narrow panel row. */
export function formatDuration(ms) {
  if (ms == null || ms < 0) return "";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Counts of each status across a run's jobs, for the summary line. */
export function jobSummary(jobs) {
  const counts = {};
  for (const job of jobs || []) {
    counts[job.status] = (counts[job.status] || 0) + 1;
  }
  return counts;
}

export const failedJobs = (run) => (run?.jobs || []).filter((j) => j.status === STATUS.failed);

/**
 * The most recent successful run strictly older than `run`, on the same branch
 * and from the same source. That is the baseline for "what broke since then".
 */
export function lastGreenBefore(runs, run) {
  if (!run) return null;
  const pivot = Date.parse(run.createdAt || run.startedAt || "") || 0;
  return (runs || [])
    .filter((r) =>
      r.source === run.source &&
      r.status === STATUS.success &&
      r.sha &&
      r.sha !== run.sha &&
      (Date.parse(r.createdAt || r.startedAt || "") || 0) < pivot &&
      (!run.branch || !r.branch || r.branch === run.branch))
    .sort((a, b) =>
      (Date.parse(b.createdAt || b.startedAt || "") || 0) -
      (Date.parse(a.createdAt || a.startedAt || "") || 0))[0] || null;
}

/** Newest first, so the panel always leads with what just happened. */
export function sortRuns(runs) {
  return [...(runs || [])].sort((a, b) => {
    const at = Date.parse(a.createdAt || a.startedAt || "") || 0;
    const bt = Date.parse(b.createdAt || b.startedAt || "") || 0;
    return bt - at;
  });
}

/** Applies the branch filter. An empty branch means "all branches". */
export function filterByBranch(runs, branch) {
  if (!branch) return runs;
  return runs.filter((r) => !r.branch || r.branch === branch);
}
