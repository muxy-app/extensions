/**
 * Selectors: predictable alphabetical sorting and text filtering.
 * These deliberately do not collapse recorded GSD/Muxy fields into a
 * Control Tower status or priority.
 */

/** Default user preferences (persisted via muxy.storage). */
export const DEFAULT_PREFS = {
  refreshIntervalMinutes: 5,
  // Land inside the active project's own view on panel open (vs all-projects list).
  openOnActiveProject: true,
  // Non-GSD projects stay out of the workstream list by default.
  showNonGsd: false,
  hiddenProjects: [], // project ids excluded from the dashboard entirely (FR-004)
  filters: { query: "" },
};

/** Return workstreams predictably by project/worktree name. */
export function buildRows(state, prefs = DEFAULT_PREFS) {
  const rows = [];
  for (const ws of state.workstreams.values()) {
    const hidden = (prefs.hiddenProjects ?? []).includes(ws.projectId);
    if (hidden) continue;
    rows.push({ ...ws });
  }
  return rows.sort(compareWorkstreams);
}

/**
 * Apply text search (FR-042).
 * @param {ReturnType<typeof buildRows>} rows
 * @param {{query?:string}} filters
 */
export function filterRows(rows, filters = {}) {
  const query = (filters.query ?? "").trim().toLowerCase();

  return rows.filter((r) => {
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
        r.gsd?.statusLine,
        r.gsd?.frontmatterStatus,
        r.gsd?.verification,
        r.gsd?.verificationDetail,
        ...(r.gsd?.errors ?? []),
        r.agent?.providerId,
        r.agent?.runtimeState,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

export function compareWorkstreams(a, b) {
  const project = String(a.projectName).localeCompare(String(b.projectName));
  if (project !== 0) return project;
  return String(a.worktreeName ?? a.git?.branch ?? "").localeCompare(
    String(b.worktreeName ?? b.git?.branch ?? ""),
  );
}
