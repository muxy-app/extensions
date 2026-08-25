/**
 * Preferences persisted in extension-scoped `muxy.storage` (FR-043).
 * Values are validated and clamped; storage failures fall back to defaults
 * so the dashboard always renders (NFR-012).
 */
import { DEFAULT_PREFS } from "../core/selectors.js";

const KEY = "prefs.v1";
const MAX_HIDDEN_PROJECTS = 200;
export const REFRESH_INTERVAL_OPTIONS = [0, 1, 5, 15, 30];

/** @returns {Promise<typeof DEFAULT_PREFS>} */
export async function loadPrefs() {
  try {
    const raw = await globalThis.muxy?.storage?.get?.(KEY);
    if (!raw || typeof raw !== "object") return structuredClone(DEFAULT_PREFS);
    return sanitizePrefs(raw);
  } catch {
    return structuredClone(DEFAULT_PREFS);
  }
}

/** @returns {Promise<boolean>} success */
export async function savePrefs(prefs) {
  try {
    await globalThis.muxy?.storage?.set?.(KEY, sanitizePrefs(prefs));
    return true;
  } catch {
    return false;
  }
}

/** Reset to defaults without touching any project file (FR-063). */
export async function resetPrefs() {
  try {
    await globalThis.muxy?.storage?.delete?.(KEY);
  } catch { /* best effort */ }
  return structuredClone(DEFAULT_PREFS);
}

/** Validate + clamp an arbitrary object into a safe prefs shape. */
export function sanitizePrefs(raw) {
  const out = structuredClone(DEFAULT_PREFS);
  if (REFRESH_INTERVAL_OPTIONS.includes(raw.refreshIntervalMinutes)) {
    out.refreshIntervalMinutes = raw.refreshIntervalMinutes;
  }
  if (typeof raw.openOnActiveProject === "boolean") out.openOnActiveProject = raw.openOnActiveProject;
  if (typeof raw.showNonGsd === "boolean") out.showNonGsd = raw.showNonGsd;
  if (Array.isArray(raw.hiddenProjects)) {
    out.hiddenProjects = raw.hiddenProjects
      .filter((id) => typeof id === "string" && id.length > 0 && id.length <= 128)
      .slice(0, MAX_HIDDEN_PROJECTS);
  }
  if (raw.filters && typeof raw.filters === "object") {
    if (typeof raw.filters.query === "string") out.filters.query = raw.filters.query.slice(0, 200);
  }
  return out;
}

/** Whether the bounded cross-project planning/Git refresh interval has elapsed. */
export function refreshDue(lastRefresh, intervalMinutes, now = Date.now()) {
  if (!REFRESH_INTERVAL_OPTIONS.includes(intervalMinutes) || intervalMinutes === 0) return false;
  const last = Date.parse(lastRefresh ?? "");
  if (!Number.isFinite(last)) return true;
  return now - last >= intervalMinutes * 60_000;
}

/**
 * Bounded diagnostics snapshot for persistence — never source-file bodies (NFR-023).
 * Kept small enough to sit far under the 1 MB per-value storage cap.
 */
export async function saveDiagnosticsSnapshot(payload) {
  try {
    await globalThis.muxy?.storage?.set?.("diagnostics.v1", payload);
  } catch { /* diagnostics are best-effort */ }
}
