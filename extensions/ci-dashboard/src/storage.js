// Per-repository source configuration, persisted in muxy.storage.
//
// Config is keyed by repository root rather than by the picker's cwd, so the
// same setup applies whether the project is selected explicitly or reached
// through "Current project", and it survives worktree switches.

const KEY_PREFIX = "sources:v1:";
const AUTH_KINDS = ["none", "token", "header", "basic", "curlConfig"];

export const emptyConfig = () => ({ sources: [], detectionDismissed: false });

const storageKey = (repoRoot) => `${KEY_PREFIX}${repoRoot || "unknown"}`;

export async function loadConfig(repoRoot) {
  try {
    const stored = await window.muxy?.storage?.get?.(storageKey(repoRoot));
    if (!stored || typeof stored !== "object") return emptyConfig();
    return {
      sources: Array.isArray(stored.sources) ? stored.sources.map(normalizeSource) : [],
      detectionDismissed: Boolean(stored.detectionDismissed),
    };
  } catch (e) {
    console.warn("[ci-dashboard] could not read stored sources:", e);
    return emptyConfig();
  }
}

export async function saveConfig(repoRoot, config) {
  try {
    await window.muxy?.storage?.set?.(storageKey(repoRoot), {
      sources: (config.sources || []).map(normalizeSource),
      detectionDismissed: Boolean(config.detectionDismissed),
    });
    return true;
  } catch (e) {
    console.error("[ci-dashboard] could not save sources:", e);
    return false;
  }
}

/** Fills in defaults so older stored records keep working after a change here. */
function normalizeSource(source) {
  const kind = source?.kind === "gitlab" || source?.kind === "cctray" ? source.kind : "github";
  const base = {
    id: source?.id || newId(),
    kind,
    label: source?.label || "",
    enabled: source?.enabled !== false,
  };
  if (kind !== "cctray") return base;
  return {
    ...base,
    url: source?.url || "",
    auth: normalizeAuth(source?.auth),
    insecure: Boolean(source?.insecure),
    // Empty means "every project the feed reports"; otherwise an allowlist of
    // CCTray project names, which is how one shared feed is narrowed to this repo.
    projects: Array.isArray(source?.projects) ? source.projects.filter((p) => typeof p === "string") : [],
  };
}

function normalizeAuth(auth) {
  const kind = AUTH_KINDS.includes(auth?.kind) ? auth.kind : "none";
  switch (kind) {
    case "token":
      return { kind, token: String(auth.token || "") };
    case "header":
      return { kind, name: String(auth.name || ""), value: String(auth.value || "") };
    case "basic":
      return { kind, user: String(auth.user || ""), password: String(auth.password || "") };
    case "curlConfig":
      return { kind, path: String(auth.path || "") };
    default:
      return { kind: "none" };
  }
}

export function newId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** True when the credential is kept in Muxy's store rather than a user file. */
export function storesSecret(source) {
  const kind = source?.auth?.kind;
  return kind === "token" || kind === "header" || kind === "basic";
}
