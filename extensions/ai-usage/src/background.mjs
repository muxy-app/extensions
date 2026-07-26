import { parseCodexRows, parseKimiRows, parseOpenCodeGoRows, parseGrokRows, parseFactoryRows, parseClaudeRows } from "./live-parsers.mjs";
import { parseJSON, formatPlanName } from "./live-runtime.mjs";
import { providerCatalog } from "./providers.mjs";
import { statusCachePath } from "./status-cache.mjs";

try {
  muxy.events.subscribe("extension.ai-usage.keepalive", () => {});

  const home = readHome();
  const startMs = Date.now();

  // ── Startup: restore status bar from cache ──
  let autoRefreshSeconds = 300;
  let cachePayload = null;
  try {
    cachePayload = readCache();
    if (cachePayload) {
      autoRefreshSeconds = cachePayload.autoRefreshSeconds || 300;
      const presentation = statusBarPresentation(cachePayload);
      if (presentation) {
        muxy.statusbar.set({ id: "ai-usage", icon: presentation.icon, text: presentation.text });
        console.log(`ai-usage status bar restored ${presentation.text}`);
      } else {
        console.log("ai-usage status cache has no displayable usage");
      }
    } else {
      console.log("ai-usage status cache missing");
    }
  } catch (error) {
    console.warn("ai-usage background restore failed", error);
  }

  // ── Polling loop ──
  function poll() {
    try {
      const nowMs = Date.now();
      const payload = readCache();

      // No cache yet — nothing to refresh
      if (!payload || !Array.isArray(payload.snapshots)) return;

      const oldSnapshots = payload.snapshots;
      const displayMode = payload.displayMode === "remaining" ? "remaining" : "used";
      const pinnedPreview = payload.pinnedPreview || "";
      const currentInterval = payload.autoRefreshSeconds || 300;

      // Popover heartbeat: if popover wrote a recent heartbeat, it is active
      const heartbeatAge = payload.popoverHeartbeat ? nowMs - payload.popoverHeartbeat : Infinity;
      const popoverActive = heartbeatAge < currentInterval * 1000 * 1.5;

      // Untracked (hidden) providers are excluded from refresh and cache output
      const tracked = payload.trackedProviderIDs;
      const isTracked = Array.isArray(tracked)
        ? (id) => tracked.includes(id)
        : () => true; // backward compat — no tracked list means allow all

      // Re-fetch each previously-available provider in sequence.
      // On failure the old snapshot is kept so the status bar doesn't flicker.
      // Token-refresh providers (kimi, claude) are skipped when popover is active.
      // Untracked providers are also excluded (cleaned from cache).
      const updatedSnapshots = oldSnapshots.filter((snapshot) => isTracked(snapshot.id)).map((snapshot) => {
        if (snapshot.state && snapshot.state.kind !== "available") return snapshot;
        const provider = providerCatalog.find((p) => p.id === snapshot.id);
        if (!provider) return snapshot;
        if (popoverActive && needsTokenRefresh(provider.id)) return snapshot;
        const fresh = syncFetch(home, provider, nowMs);
        return fresh || snapshot;
      });

      // Build new cache payload (no popoverHeartbeat — distinguishes background writes)
      const newPayload = JSON.stringify({
        version: 1,
        displayMode,
        pinnedPreview,
        autoRefreshSeconds: currentInterval,
        trackedProviderIDs: tracked,
        snapshots: updatedSnapshots,
      });

      // Write atomically: temp → rename
      const tmpPath = `${statusCachePath}.tmp`;
      const tee = muxy.exec(["/usr/bin/tee", tmpPath], { stdin: newPayload, timeoutMs: 3000 });
      if (tee && tee.exitCode === 0) {
        muxy.exec(["/bin/mv", "-f", tmpPath, statusCachePath], { timeoutMs: 3000 });
      }

      // Update status bar
      const presentation = statusBarPresentation(JSON.parse(newPayload));
      if (presentation) {
        muxy.statusbar.set({ id: "ai-usage", icon: presentation.icon, text: presentation.text });
      }
    } catch (error) {
      console.warn("ai-usage background poll failed", error);
    }
  }

  function needsTokenRefresh(id) {
    return id === "kimi" || id === "claude";
  }

  // Schedule polling. If cache was present, do an initial poll right away.
  if (cachePayload && Array.isArray(cachePayload.snapshots) && cachePayload.snapshots.length > 0) {
    poll();
  }
  if (typeof setInterval === "function") {
    setInterval(poll, autoRefreshSeconds * 1000);
  } else {
    console.warn("ai-usage background polling timer unavailable");
  }

  console.log(`ai-usage background polling started (interval=${autoRefreshSeconds}s, elapsed=${Date.now() - startMs}ms)`);
} catch (error) {
  console.warn("ai-usage background init failed", error);
}

// ═══════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════

function readCache() {
  const result = muxy.exec(["/bin/cat", statusCachePath], { timeoutMs: 3000 });
  if (!result || result.exitCode !== 0) return null;
  const trimmed = String(result.stdout || "").trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

function readFile(path) {
  const result = muxy.exec(["/bin/cat", path], { timeoutMs: 3000 });
  if (!result || result.exitCode !== 0) return "";
  return String(result.stdout || "");
}

function readJSON(path) {
  const raw = readFile(path);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function readHome() {
  const result = muxy.exec(["/usr/bin/env"], { timeoutMs: 3000 });
  if (!result || result.exitCode !== 0) return "";
  const line = String(result.stdout || "").split("\n").find((entry) => entry.startsWith("HOME="));
  return line ? line.slice(5) : "";
}

function readEnv(key) {
  const result = muxy.exec(["/usr/bin/env"], { timeoutMs: 3000 });
  if (!result || result.exitCode !== 0) return "";
  const lines = String(result.stdout || "").split("\n");
  for (const line of lines) {
    if (line.startsWith(`${key}=`)) return line.slice(key.length + 1);
  }
  return "";
}

// ── Synchronous curl ──

function syncCurl(url, method, headers, body) {
  const lines = [`url = "${escapeCurl(url)}"`, `request = "${escapeCurl(method)}"`];
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      lines.push(`header = "${escapeCurl(`${key}: ${value}`)}"`);
    }
  }
  if (body != null) {
    lines.push(`data = "${escapeCurl(typeof body === "string" ? body : JSON.stringify(body))}"`);
  }
  const config = `${lines.join("\n")}\n`;

  const result = muxy.exec(
    ["/usr/bin/curl", "--silent", "--show-error", "--location", "--max-time", "20", "--write-out", "\n%{http_code}", "--config", "-"],
    { stdin: config, timeoutMs: 30000 },
  );
  if (!result || result.exitCode !== 0) return null;
  const trimmed = String(result.stdout || "").trimEnd();
  const split = trimmed.lastIndexOf("\n");
  if (split < 0) return null;
  const status = Number(trimmed.slice(split + 1));
  if (!Number.isFinite(status) || status < 200 || status >= 300) return null;
  try { return JSON.parse(trimmed.slice(0, split) || "{}"); } catch { return null; }
}

function escapeCurl(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n");
}

// ── Provider sync fetch ──

function syncFetch(home, provider, nowMs) {
  switch (provider.id) {
    case "opencode-go":
      return fetchOpenCodeGoSync(home, provider, nowMs);
    case "codex":
      return fetchCodexSync(home, provider);
    case "kimi":
      return fetchKimiSync(home, provider);
    case "claude":
      return fetchClaudeSync(home, provider);
    case "grok":
      return fetchGrokSync(home, provider);
    case "factory":
      return fetchFactorySync(provider);
    default:
      return null; // not implemented in background → keep cached data
  }
}

function makeSnapshot(provider, rows, planName) {
  return {
    id: provider.id,
    name: provider.name,
    icon: provider.icon,
    fetchedAt: new Date().toISOString(),
    state: { kind: "available" },
    planName: planName || undefined,
    rows: rows.map((r) => ({
      ...r,
      resetAt: r.resetAt instanceof Date ? r.resetAt.toISOString() : r.resetAt,
    })),
  };
}

// ── opencode-go (local sqlite, no network) ──

function fetchOpenCodeGoSync(home, provider, nowMs) {
  const dbPath = `${home}/.local/share/opencode/opencode.db`;
  const result = muxy.exec(["/usr/bin/sqlite3", dbPath, "SELECT usage_json FROM usage ORDER BY id DESC LIMIT 1"], { timeoutMs: 3000 });
  if (!result || result.exitCode !== 0) return null;
  const payload = parseJSON(result.stdout);
  if (!payload) return null;
  const rows = parseOpenCodeGoRows(payload, nowMs);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const planName = formatPlanName(payload?.plan?.display_name || payload?.plan_name || payload?.tier || "");
  return makeSnapshot(provider, rows, planName);
}

// ── codex ──

const codexCredPaths = [
  (home) => `${home}/.codex/auth.json`,
  (home) => `${home}/.config/codex/auth.json`,
];

function fetchCodexSync(home, provider) {
  const cred = readCodexCreds(home);
  if (!cred) return null;
  const headers = { Authorization: `Bearer ${cred.token}`, Accept: "application/json" };
  if (cred.accountID) headers["ChatGPT-Account-Id"] = cred.accountID;
  const payload = syncCurl("https://chatgpt.com/backend-api/wham/usage", "GET", headers);
  if (!payload) return null;
  const rows = parseCodexRows(payload);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return makeSnapshot(provider, rows);
}

function readCodexCreds(home) {
  for (const path of codexCredPaths) {
    const data = readJSON(path(home));
    if (data && data.accessToken) {
      return { token: data.accessToken, accountID: data.accountID || data.account_id || "" };
    }
  }
  return null;
}

// ── kimi ──

const kimiCredPaths = [
  (home) => `${home}/.kimi-code/credentials/kimi-code.json`,
  (home) => `${home}/.kimi/credentials/kimi-code.json`,
];

function fetchKimiSync(home, provider) {
  let cred = readKimiCreds(home);
  if (!cred) return null;

  // Refresh expired token in background (rename is atomic, safe vs popover write)
  if (cred.expiresAt && Date.now() > cred.expiresAt * 1000) {
    if (!cred.refreshToken) return null;
    const refreshed = refreshKimiCredsSync(home, cred);
    if (!refreshed) return null;
    cred = refreshed;
  }

  const payload = syncCurl("https://api.kimi.com/coding/v1/usages", "GET", {
    Authorization: `Bearer ${cred.token}`,
    Accept: "application/json",
  });
  if (!payload) return null;
  const rows = parseKimiRows(payload);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return makeSnapshot(provider, rows);
}

function readKimiCreds(home) {
  for (const path of kimiCredPaths) {
    const data = readJSON(path(home));
    if (data && data.access_token) {
      return {
        token: data.access_token,
        refreshToken: data.refresh_token || null,
        expiresAt: Number(data.expires_at) || null,
        credentialPath: path(home),
      };
    }
  }
  return null;
}

function refreshKimiCredsSync(home, cred) {
  const body = `client_id=17e5f671-d194-4dfb-9706-5516cb48c098&grant_type=refresh_token&refresh_token=${escapeCurl(cred.refreshToken)}`;
  const config = `url = "https://auth.kimi.com/api/oauth/token"\nrequest = "POST"\nheader = "Content-Type: application/x-www-form-urlencoded"\nheader = "Accept: application/json"\ndata = "${escapeCurl(body)}"\n`;

  const result = muxy.exec(
    ["/usr/bin/curl", "--silent", "--show-error", "--location", "--max-time", "20", "--write-out", "\n%{http_code}", "--config", "-"],
    { stdin: config, timeoutMs: 30000 },
  );
  if (!result || result.exitCode !== 0) return null;
  const trimmed = String(result.stdout || "").trimEnd();
  const split = trimmed.lastIndexOf("\n");
  if (split < 0) return null;
  const status = Number(trimmed.slice(split + 1));
  if (!Number.isFinite(status) || status < 200 || status >= 300) return null;

  let response;
  try { response = JSON.parse(trimmed.slice(0, split) || "{}"); } catch { return null; }
  if (!response?.access_token) return null;

  const newAccessToken = response.access_token;
  const newExpiresIn = response.expires_in || 900;
  const newExpiresAt = Math.floor(Date.now() / 1000) + newExpiresIn;
  const newRefreshToken = response.refresh_token || cred.refreshToken;

  // Atomic write: temp → rename (same pattern as popover, safe under contention)
  const updated = JSON.stringify({
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
    expires_at: newExpiresAt,
    expires_in: newExpiresIn,
    scope: response.scope || "kimi-code",
    token_type: response.token_type || "Bearer",
  });
  const tmpPath = `${cred.credentialPath}.tmp`;
  const tee = muxy.exec(["/usr/bin/tee", tmpPath], { stdin: updated, timeoutMs: 3000 });
  if (tee && tee.exitCode === 0) {
    muxy.exec(["/bin/mv", "-f", tmpPath, cred.credentialPath], { timeoutMs: 3000 });
  }

  return {
    token: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAt: newExpiresAt,
    credentialPath: cred.credentialPath,
  };
}

// ── claude ──

const claudeCredPaths = [
  (home) => `${home}/.claude/.credentials.json`,
  (home) => `${home}/.config/claude/.credentials.json`,
];

function fetchClaudeSync(home, provider) {
  let cred = readClaudeCreds(home);
  if (!cred) return null;

  // Refresh expired token in background (expiresAt is in ms)
  if (cred.expiresAt && Date.now() > cred.expiresAt) {
    if (!cred.refreshToken) return null;
    const refreshed = refreshClaudeCredsSync(home, cred);
    if (!refreshed) return null;
    cred = refreshed;
  }

  const payload = syncCurl("https://api.claude.ai/api/organization/usage", "GET", {
    Cookie: `sessionKey=${cred.token}`,
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Claude",
  });
  if (!payload) return null;
  const rows = parseClaudeRows(payload);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return makeSnapshot(provider, rows);
}

function readClaudeCreds(home) {
  for (const path of claudeCredPaths) {
    const data = readJSON(path(home));
    if (data && data.claudeAiOauth) {
      const oauth = data.claudeAiOauth;
      if (oauth.accessToken) {
        return {
          token: oauth.accessToken,
          refreshToken: oauth.refreshToken || null,
          expiresAt: Number(oauth.expiresAt) || null,
          credentialPath: path(home),
          raw: data,
        };
      }
    }
  }
  return null;
}

function refreshClaudeCredsSync(home, cred) {
  const body = `grant_type=refresh_token&refresh_token=${escapeCurl(cred.refreshToken)}`;
  const config =
    `url = "https://api.claude.ai/api/oauth/token"\n` +
    `request = "POST"\n` +
    `header = "Content-Type: application/x-www-form-urlencoded"\n` +
    `header = "Accept: application/json"\n` +
    `data = "${escapeCurl(body)}"\n`;

  const result = muxy.exec(
    ["/usr/bin/curl", "--silent", "--show-error", "--location", "--max-time", "20", "--write-out", "\n%{http_code}", "--config", "-"],
    { stdin: config, timeoutMs: 30000 },
  );
  if (!result || result.exitCode !== 0) return null;
  const trimmed = String(result.stdout || "").trimEnd();
  const split = trimmed.lastIndexOf("\n");
  if (split < 0) return null;
  const status = Number(trimmed.slice(split + 1));
  if (!Number.isFinite(status) || status < 200 || status >= 300) return null;

  let response;
  try { response = JSON.parse(trimmed.slice(0, split) || "{}"); } catch { return null; }
  if (!response?.access_token) return null;

  const newAccessToken = response.access_token;
  const newExpiresIn = response.expires_in || 3600;
  const newExpiresAt = Date.now() + newExpiresIn * 1000;
  const newRefreshToken = response.refresh_token || cred.refreshToken;

  // Atomic write: temp → rename (same pattern as popover, safe under contention)
  const updated = JSON.stringify({
    ...cred.raw,
    claudeAiOauth: {
      ...cred.raw.claudeAiOauth,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresAt: newExpiresAt,
    },
  });
  const tmpPath = `${cred.credentialPath}.tmp`;
  const tee = muxy.exec(["/usr/bin/tee", tmpPath], { stdin: updated, timeoutMs: 3000 });
  if (tee && tee.exitCode === 0) {
    muxy.exec(["/bin/mv", "-f", tmpPath, cred.credentialPath], { timeoutMs: 3000 });
  }

  return {
    token: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAt: newExpiresAt,
    credentialPath: cred.credentialPath,
    raw: cred.raw,
  };
}

// ── grok ──

const grokCredPaths = [
  (home) => `${home}/.grok/auth.json`,
  (home) => `${home}/.grok-cli/credentials.json`,
];

function fetchGrokSync(home, provider) {
  const apiKey = readGrokKey(home);
  if (!apiKey) return null;
  const payload = syncCurl("https://cli-chat-proxy.grok.com/v1/billing", "GET", {
    "x-api-key": apiKey,
    Accept: "application/json",
  });
  if (!payload) return null;
  const rows = parseGrokRows(payload);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const planName = formatPlanName(payload?.plan || payload?.plan_name || payload?.name || "");
  return makeSnapshot(provider, rows, planName);
}

function readGrokKey(home) {
  for (const path of grokCredPaths) {
    const data = readJSON(path(home));
    if (data && data.api_key) return data.api_key;
    if (data && data.apiKey) return data.apiKey;
    if (data && data.x_api_key) return data.x_api_key;
    if (data && data["x-api-key"]) return data["x-api-key"];
  }
  return null;
}

// ── factory ──

function fetchFactorySync(provider) {
  const token = readEnv("FACTORY_ACCESS_TOKEN");
  if (!token) return null;
  const payload = syncCurl("https://api.factory.ai/api/organization/subscription/usage", "POST", {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });
  if (!payload) return null;
  const rows = parseFactoryRows(payload);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const planName = formatPlanName(payload?.plan_name || payload?.planName || payload?.usage?.plan_name || "");
  return makeSnapshot(provider, rows, planName);
}

// ═══════════════════════════════════════════════════
//  Status bar helpers (kept from original background.mjs)
// ═══════════════════════════════════════════════════

function statusBarPresentation(payload) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.snapshots)) return null;
  const displayMode = payload.displayMode === "remaining" ? "remaining" : "used";
  const selected = selectPreview(payload.snapshots, payload.pinnedPreview);
  if (!selected) return null;
  const percent = selected.row ? selected.row.percent : maxPercent(selected.snapshot);
  if (percent === null || percent === undefined) return null;
  const clamped = clamp(Number(percent), 0, 100);
  const displayed = displayMode === "remaining" ? clamp(100 - clamped, 0, 100) : clamped;
  return {
    icon: { svg: `assets/${selected.snapshot.icon}.svg` },
    text: `${Math.round(displayed)}%`
  };
}

function selectPreview(snapshots, pinnedRawValue) {
  const pin = parsePin(pinnedRawValue);
  if (pin) {
    const snapshot = snapshots.find((item) => item.id === pin.providerID && item.state && item.state.kind === "available");
    if (snapshot) {
      if (pin.rowLabel) {
        const row = (snapshot.rows || []).find((candidate) => candidate.label === pin.rowLabel && candidate.percent !== null && candidate.percent !== undefined);
        if (row) return { snapshot, row };
      } else if ((snapshot.rows || []).some((row) => row.percent !== null && row.percent !== undefined)) {
        return { snapshot, row: null };
      }
    }
  }
  const available = snapshots.filter((snapshot) => snapshot.state && snapshot.state.kind === "available");
  const ranked = available.sort((left, right) => maxPercent(right) - maxPercent(left));
  return ranked[0] ? { snapshot: ranked[0], row: null } : null;
}

function parsePin(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const parts = trimmed.split("::");
  return {
    providerID: parts.shift(),
    rowLabel: parts.length === 0 ? null : parts.join("::") || null
  };
}

function maxPercent(snapshot) {
  const values = (snapshot.rows || []).map((row) => row.percent).filter((value) => value !== null && value !== undefined);
  return values.length === 0 ? null : Math.max(...values);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
