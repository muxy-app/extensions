const cacheVersion = 1;

export function parseCachedSnapshots(raw) {
  try {
    const payload = JSON.parse(String(raw || "null"));
    if (payload?.version !== cacheVersion || !Array.isArray(payload.snapshots)) return [];
    return payload.snapshots.flatMap(hydrateSnapshot);
  } catch {
    return [];
  }
}

export function serializeSnapshots(snapshots, storedAt = new Date()) {
  return JSON.stringify({
    version: cacheVersion,
    storedAt: storedAt.toISOString(),
    snapshots: snapshots.map(serializeSnapshot)
  });
}

function hydrateSnapshot(snapshot) {
  const id = stringValue(snapshot?.id);
  const name = stringValue(snapshot?.name);
  const icon = stringValue(snapshot?.icon);
  if (!id || !name || !icon) return [];
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows.flatMap(hydrateRow) : [];
  const state = hydrateState(snapshot.state);
  return [{
    id,
    name,
    icon,
    fetchedAt: dateValue(snapshot.fetchedAt) || new Date(),
    planName: stringValue(snapshot?.planName) || undefined,
    state,
    rows: state.kind === "available" ? rows : []
  }];
}

function hydrateRow(row) {
  const label = stringValue(row?.label);
  if (!label) return [];
  return [{
    id: stringValue(row.id) || label,
    label,
    percent: percentValue(row.percent),
    resetAt: dateValue(row.resetAt),
    detail: stringValue(row.detail),
    periodDuration: durationValue(row.periodDuration)
  }];
}

function hydrateState(state) {
  const kind = state?.kind === "available" || state?.kind === "error" ? state.kind : "unavailable";
  return kind === "available" ? { kind } : { kind, message: stringValue(state?.message) || "No usage data" };
}

function serializeSnapshot(snapshot) {
  return {
    ...snapshot,
    fetchedAt: snapshot.fetchedAt instanceof Date ? snapshot.fetchedAt.toISOString() : snapshot.fetchedAt,
    rows: snapshot.rows.map((row) => ({
      ...row,
      resetAt: row.resetAt instanceof Date ? row.resetAt.toISOString() : row.resetAt
    }))
  };
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function percentValue(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : null;
}

function durationValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function dateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
