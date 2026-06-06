import { defaultPreferences, providerCatalog } from "./providers.mjs";

const allowedDisplayModes = new Set(["used", "remaining"]);
const allowedRefreshSeconds = new Set([300, 900, 1800, 3600]);

export function preferencesFromStorage(read) {
  const defaults = defaultPreferences();
  return {
    enabled: read("enabled") !== "false",
    displayMode: displayMode(read("displayMode"), defaults.displayMode),
    autoRefreshSeconds: refreshSeconds(read("autoRefreshSeconds"), defaults.autoRefreshSeconds),
    includeSecondary: read("includeSecondary") === "true",
    pinnedPreview: String(read("pinnedPreview") || ""),
    trackedProviderIDs: providerSet(read("tracked"), defaults.trackedProviderIDs),
    enabledProviderIDs: providerSet(read("providerEnabled"), defaults.enabledProviderIDs),
  };
}

function displayMode(value, fallback) {
  return allowedDisplayModes.has(value) ? value : fallback;
}

function refreshSeconds(value, fallback) {
  const parsed = Number(value);
  return allowedRefreshSeconds.has(parsed) ? parsed : fallback;
}

function providerSet(value, fallback) {
  const parsed = stringArray(value);
  if (!parsed) return new Set(fallback);
  const allowedIDs = new Set(providerCatalog.map((provider) => provider.id));
  const filtered = parsed.filter((id) => allowedIDs.has(id));
  return new Set(filtered);
}

function stringArray(value) {
  try {
    const parsed = JSON.parse(String(value ?? "null"));
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : null;
  } catch {
    return null;
  }
}
