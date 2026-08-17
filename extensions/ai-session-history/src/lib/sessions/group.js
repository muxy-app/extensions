/**
 * Build provider groups from sessions + installed metadata.
 * Groups ordered by most recent session; empty groups omitted unless they have errors.
 */
export function buildGroups(installed, sessionsByCli, errorsByCli = {}) {
  const groups = [];
  for (const provider of installed) {
    const sessions = [...(sessionsByCli[provider.id] ?? [])].sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    );
    const error = errorsByCli[provider.id];
    if (!sessions.length && !error) continue;
    const latestAt = sessions.reduce((max, s) => Math.max(max, s.updatedAt || 0), 0);
    groups.push({
      cli: provider.id,
      displayName: provider.displayName,
      sessions,
      error: error || null,
      latestAt,
    });
  }
  groups.sort((a, b) => {
    if (b.latestAt !== a.latestAt) return b.latestAt - a.latestAt;
    return a.displayName.localeCompare(b.displayName);
  });
  return groups;
}

export function filterGroups(groups, filter) {
  if (!filter || filter === "all") return groups;
  return groups.filter((g) => g.cli === filter);
}

export function flattenSessions(groups) {
  return groups.flatMap((g) => g.sessions);
}

/**
 * Groups a sorted array of sessions into date buckets.
 * Returns an array of { label, sessions } objects in chronological order
 * (most-recent bucket first).
 */
export function groupByDate(sessions, dateGroupFn) {
  const buckets = new Map();
  for (const s of sessions) {
    const label = dateGroupFn(s.updatedAt);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(s);
  }
  return Array.from(buckets, ([label, sessions]) => ({ label, sessions }));
}
