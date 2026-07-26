const KEY = "plex-dashboard:prefs";

const DEFAULTS = {
  clientId: null,
  selectedServer: null,
  killMessageDefault: "",
  refreshIntervalSec: 10,
  sortByServer: {},
};

let cache = null;

function readRaw() {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeRaw(value) {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // localStorage may be unavailable; fall back silently
  }
}

function applyDefaults(raw) {
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  return {
    clientId: typeof parsed.clientId === "string" ? parsed.clientId : DEFAULTS.clientId,
    selectedServer:
      parsed.selectedServer && typeof parsed.selectedServer === "object"
        ? parsed.selectedServer
        : DEFAULTS.selectedServer,
    killMessageDefault:
      typeof parsed.killMessageDefault === "string"
        ? parsed.killMessageDefault
        : DEFAULTS.killMessageDefault,
    refreshIntervalSec:
      Number.isFinite(parsed.refreshIntervalSec) && parsed.refreshIntervalSec >= 10
        ? Math.floor(parsed.refreshIntervalSec)
        : DEFAULTS.refreshIntervalSec,
    sortByServer:
      parsed.sortByServer && typeof parsed.sortByServer === "object"
        ? parsed.sortByServer
        : { ...DEFAULTS.sortByServer },
  };
}

export async function setServerSort(serverId, sortKey) {
  const current = (cache && cache.sortByServer) || {};
  return savePrefs({ sortByServer: { ...current, [serverId]: sortKey } });
}

export function getServerSort(prefs, serverId, fallback) {
  return (prefs.sortByServer && prefs.sortByServer[serverId]) || fallback;
}

export async function loadPrefs() {
  if (cache) return cache;
  cache = applyDefaults(readRaw());
  if (!cache.clientId) {
    cache.clientId = generateUuid();
    writeRaw(JSON.stringify(cache));
  }
  return cache;
}

export async function savePrefs(next) {
  cache = { ...(cache || DEFAULTS), ...next };
  writeRaw(JSON.stringify(cache));
  return cache;
}

export async function clearSelectedServer() {
  return savePrefs({ selectedServer: null });
}

function generateUuid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
