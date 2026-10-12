// Claude Code OAuth refresh, shared by the popover (async) and background (sync) collectors.
// Refresh tokens rotate: after a refresh, the old refresh token is spent. The new
// credentials must be written back to where Claude Code reads them (Keychain or file),
// or Claude Code will need `/login`. The request and the stored fields match Claude Code.

export const claudeKeychainService = "Claude Code-credentials";

const defaultScopes = ["user:profile", "user:inference", "user:sessions:claude_code", "user:mcp_servers", "user:file_upload"];

export function claudeRefreshRequest(oauth) {
  const scopes = Array.isArray(oauth.scopes) && oauth.scopes.length > 0 ? oauth.scopes : defaultScopes;
  return {
    url: "https://platform.claude.com/v1/oauth/token",
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: {
      grant_type: "refresh_token",
      refresh_token: oauth.refreshToken,
      client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
      scope: scopes.join(" "),
    },
  };
}

// Returns the full stored payload with refreshed claudeAiOauth fields, or null.
export function applyClaudeRefresh(payload, response, now = Date.now()) {
  if (!response?.access_token) return null;
  const oauth = payload.claudeAiOauth;
  return {
    ...payload,
    claudeAiOauth: {
      ...oauth,
      accessToken: response.access_token,
      refreshToken: response.refresh_token || oauth.refreshToken,
      expiresAt: now + (response.expires_in || 3600) * 1000,
      ...(typeof response.refresh_token_expires_in === "number" ? { refreshTokenExpiresAt: now + response.refresh_token_expires_in * 1000 } : {}),
      ...(typeof response.scope === "string" ? { scopes: response.scope.split(" ").filter(Boolean) } : {}),
    },
  };
}

// Claude Code uses `security -i` only up to this command length and otherwise falls back to argv.
// AI Usage never uses argv, because argv shows the token in the process list.
const keychainCommandLimit = 4032;

// Room for what a refresh can add to the stored payload (refreshTokenExpiresAt, scopes, longer tokens).
export const claudeRefreshReserve = 512;

// stdin for `/usr/bin/security -i` (same command that Claude Code uses),
// or null if the command plus `reserve` is longer than the `security -i` limit.
export function claudeKeychainWriteCommand(account, payload, reserve = 0) {
  const command = `add-generic-password -U -a "${account}" -s "${claudeKeychainService}" -X "${utf8Hex(JSON.stringify(payload))}"\n`;
  return command.length + reserve <= keychainCommandLimit ? command : null;
}

export function isSafeKeychainAccount(account) {
  return /^[A-Za-z0-9._@-]+$/.test(account || "");
}

function utf8Hex(text) {
  return encodeURIComponent(text).replace(/%([0-9A-F]{2})|[\s\S]/g, (match, hex) => (hex || match.charCodeAt(0).toString(16).padStart(2, "0")).toLowerCase());
}
