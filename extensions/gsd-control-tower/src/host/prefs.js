/**
 * Preferences persisted in extension-scoped `muxy.storage` (FR-043).
 * Values are validated and clamped; storage failures fall back to defaults
 * so the dashboard always renders (NFR-012).
 */
import { DEFAULT_PREFS } from "../core/selectors.js";

const KEY = "prefs.v1";
const MAX_HIDDEN_PROJECTS = 200;

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
  if (Number.isFinite(raw.staleThresholdMinutes)) {
    out.staleThresholdMinutes = Math.min(24 * 60, Math.max(5, Math.round(raw.staleThresholdMinutes)));
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
    if (Array.isArray(raw.filters.statuses))
      out.filters.statuses = raw.filters.statuses.filter((s) => typeof s === "string").slice(0, 12);
    if (Array.isArray(raw.filters.providers))
      out.filters.providers = raw.filters.providers.filter((s) => typeof s === "string").slice(0, 20);
  }
  return out;
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
