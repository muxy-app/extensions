/**
 * Selectors: ranked attention queue, counts, filtering (FR-040..FR-044).
 * Pure functions over TowerState + preferences.
 */
import { deriveStatus, compareAttention } from "./status.js";
import { ATTENTION_STATES, CONTROL_PRIORITY } from "./types.js";

/** Default user preferences (persisted via muxy.storage). */
export const DEFAULT_PREFS = {
  staleThresholdMinutes: 45,
  // Land inside the active project's own view on panel open (vs all-projects list).
  openOnActiveProject: true,
  // Non-GSD projects stay out of "All workstreams" by default — they still
  // surface in Needs attention when an agent reports waiting/working there.
  showNonGsd: false,
  hiddenProjects: [], // project ids excluded from the dashboard entirely (FR-004)
  filters: { query: "", statuses: [], providers: [] },
};

/** Derive fresh control states for every workstream and rank them. */
export function buildRows(state, prefs = DEFAULT_PREFS, nowMs = Date.now()) {
  const thresholdMs = Math.max(1, prefs.staleThresholdMinutes ?? 45) * 60_000;
  const rows = [];
  for (const ws of state.workstreams.values()) {
    const hidden = (prefs.hiddenProjects ?? []).includes(ws.projectId);
    if (hidden) continue;
    const derived = deriveStatus(ws, { now: nowMs, staleThresholdMs: thresholdMs });
    rows.push({ ...ws, controlState: derived.controlState, attentionReason: derived.attentionReason });
  }
  // Attention-ranked; within the full list keep a stable secondary ordering.
  return rows.sort(compareAttention);
}

/** Rows that count toward attention (PRD §3.4 priority set). */
export function attentionRows(rows) {
  return rows.filter((r) => ATTENTION_STATES.has(r.controlState));
}

export function statusCounts(rows) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const r of rows) counts[r.controlState] = (counts[r.controlState] ?? 0) + 1;
  return counts;
}

/**
 * Apply search + facet filters (FR-042).
 * @param {ReturnType<typeof buildRows>} rows
 * @param {{query?:string, statuses?:string[], providers?:string[], phase?:string}} filters
 */
export function filterRows(rows, filters = {}) {
  const query = (filters.query ?? "").trim().toLowerCase();
  const statuses = new Set(filters.statuses ?? []);
  const providers = new Set((filters.providers ?? []).map((p) => p.toLowerCase()));

  return rows.filter((r) => {
    if (statuses.size && !statuses.has(r.controlState)) return false;
    if (providers.size) {
      const pid = String(r.agent?.providerId ?? "").toLowerCase();
      if (!providers.has(pid)) return false;
      if (!pid && providers.size) return false;
    }
    if (query) {
      const hay = [
        r.projectName,
        r.worktreeName,
        r.worktreePath,
        r.git?.branch,
        r.gsd?.milestone,
        r.gsd?.milestoneName,
        r.gsd?.phaseLabel,
        r.gsd?.phaseName,
        r.gsd?.planLabel,
        r.gsd?.nextAction,
        r.agent?.providerId,
        r.attentionReason,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

/** Distinct provider ids present in rows (for filter chips). */
export function knownProviders(rows) {
  const set = new Set();
  for (const r of rows) if (r.agent?.providerId) set.add(r.agent.providerId);
  return [...set].sort();
}

/**
 * The single top attention item for "reveal" actions.
 * @returns {(typeof rows)[number]|undefined}
 */
export function topAttention(rows) {
  const items = attentionRows(rows);
  return items.length ? items[0] : undefined;
}
