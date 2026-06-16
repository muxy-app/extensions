import { nonEmptyString } from "./values.mjs";
import { providerCatalog } from "./providers.mjs";
import { AuthError, fetchProviderRows, firstString, formatPlanName, jsonPath, parseJSON, readJSONPath, unavailable } from "./live-runtime.mjs";
import { parseAmpRows, parseClaudeRows, parseCodexRows, parseCopilotRows, parseCursorRows, parseFactoryRows, parseGrokRows, parseKimiRows, parseMiniMaxRows, parseOpenCodeGoRows, parseZaiPlanName, parseZaiRows } from "./live-parsers.mjs";

const providerByID = new Map(providerCatalog.map((provider) => [provider.id, provider]));

export const providerFetchers = [
  { id: "claude", fetch: fetchClaudeUsage },
  { id: "codex", fetch: fetchCodexUsage },
  { id: "amp", fetch: fetchAmpUsage },
  { id: "copilot", fetch: fetchCopilotUsage },
  { id: "cursor", fetch: fetchCursorUsage },
  { id: "factory", fetch: fetchFactoryUsage },
  { id: "grok", fetch: fetchGrokUsage },
  { id: "opencode-go", fetch: fetchOpenCodeGoUsage },
  { id: "kimi", fetch: fetchKimiUsage },
  { id: "minimax", fetch: fetchMiniMaxUsage },
  { id: "zai", fetch: fetchZaiUsage },
];

async function fetchClaudeUsage(context) {
  const provider = providerByID.get("claude");
  let credentials = await readClaudeCredentials(context);
  let token = credentials?.accessToken;
  if (!token) return unavailable(provider, "Sign in to Claude");

  // If the access token is stale, try to refresh it using the refresh_token.
  if (credentials.refreshToken && credentials.expiresAt && Date.now() > credentials.expiresAt && credentials.credentialPath) {
    try {
      const refreshed = await refreshClaudeAccessToken(context, credentials);
      if (refreshed?.accessToken) {
        token = refreshed.accessToken;
        credentials = refreshed;
      }
    } catch {
      // Fall through to the API call with the expired token
      // so the user sees the provider's error (e.g. 401 → "Sign in to Claude").
    }
  }

  const result = await fetchProviderRows(context, provider, token, {
    planName: credentials.planName || "",
    unauthenticated: "Sign in to Claude",
    url: "https://api.anthropic.com/api/oauth/usage",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", "anthropic-beta": "oauth-2025-04-20" },
    parse: parseClaudeRows,
  });
  return result;
}

async function refreshClaudeAccessToken(context, credentials) {
  if (!credentials.refreshToken || !credentials.credentialPath) return null;

  try {
    const response = await context.http({
      url: "https://platform.claude.com/v1/oauth/token",
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: {
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
        client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        scope: "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
      },
    });

    if (!response?.access_token) return null;

    const newAccessToken = response.access_token;
    const newExpiresIn = response.expires_in || 3600;
    const newExpiresAt = Date.now() + newExpiresIn * 1000;

    // Update only the access_token (and derived fields) in the credentials file.
    const raw = await context.readText(credentials.credentialPath);
    const payload = parseJSON(raw);
    if (payload?.claudeAiOauth) {
      payload.claudeAiOauth.accessToken = newAccessToken;
      payload.claudeAiOauth.expiresAt = newExpiresAt;
      if (response.refresh_token) {
        payload.claudeAiOauth.refreshToken = response.refresh_token;
      }

      // Atomic write: write to a temp file, then rename.
      const tmpPath = `${credentials.credentialPath}.tmp`;
      await context.writeText(tmpPath, JSON.stringify(payload, null, 2));
      await context.rename(tmpPath, credentials.credentialPath);
    }

    return {
      accessToken: newAccessToken,
      refreshToken: response.refresh_token || credentials.refreshToken,
      expiresAt: newExpiresAt,
      planName: credentials.planName,
      credentialPath: credentials.credentialPath,
    };
  } catch {
    return null;
  }
}

async function fetchCodexUsage(context) {
  const auth = await readCodexAuth(context);
  return fetchProviderRows(context, providerByID.get("codex"), auth?.accessToken, {
    unauthenticated: "Sign in to Codex",
    url: "https://chatgpt.com/backend-api/wham/usage",
    headers: { Authorization: `Bearer ${auth?.accessToken}`, Accept: "application/json", ...(auth?.accountID ? { "ChatGPT-Account-Id": auth.accountID } : {}) },
    parse: parseCodexRows,
  });
}

async function fetchAmpUsage(context) {
  const token = await firstString([
    context.env.AMP_API_KEY,
    readJSONPath(context, `${context.home}/.local/share/amp/secrets.json`, ["apiKey@https://ampcode.com/"]),
    readJSONPath(context, `${context.home}/.local/share/amp/secrets.json`, ["apiKey"]),
    readJSONPath(context, `${context.home}/.local/share/amp/secrets.json`, ["token"]),
  ]);
  return fetchProviderRows(context, providerByID.get("amp"), token, {
    unauthenticated: "Sign in to Amp",
    url: "https://ampcode.com/api/internal",
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: { method: "userDisplayBalanceInfo", params: {} },
    parse: parseAmpRows,
  });
}

async function fetchCopilotUsage(context) {
  const token = await firstString([
    context.env.COPILOT_GITHUB_TOKEN,
    context.env.GH_TOKEN,
    context.env.GITHUB_TOKEN,
    readCopilotHostsToken(context),
    readGHHostsToken(context),
    context.keychain("github.com"),
  ]);
  return fetchProviderRows(context, providerByID.get("copilot"), token, {
    unauthenticated: "Sign in to Copilot",
    url: "https://api.github.com/copilot_internal/user",
    headers: { Authorization: `token ${token}`, Accept: "application/json" },
    parse: parseCopilotRows,
  });
}

async function fetchCursorUsage(context) {
  const credentials = await readCursorCredentials(context);
  return fetchProviderRows(context, providerByID.get("cursor"), credentials?.accessToken, {
    planName: credentials?.planName || "",
    unauthenticated: "Sign in to Cursor",
    url: "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
    method: "POST",
    headers: { Authorization: `Bearer ${credentials?.accessToken}`, "Content-Type": "application/json", "Connect-Protocol-Version": "1" },
    body: {},
    parse: parseCursorRows,
  });
}

async function readCursorCredentials(context) {
  const accessToken = nonEmptyString(context.env.CURSOR_ACCESS_TOKEN) || "";
  if (accessToken) return { accessToken, refreshToken: "", planName: "" };

  const dbPaths = [
    `${context.home}/Library/Application Support/Cursor/User/globalStorage/state.vscdb`,
    `${context.home}/.config/Cursor/User/globalStorage/state.vscdb`,
  ];

  for (const dbPath of dbPaths) {
    const result = await context.exec(
      ["/usr/bin/sqlite3", dbPath, "-separator", "|", "SELECT key, value FROM ItemTable WHERE key IN ('cursorAuth/accessToken','cursorAuth/refreshToken','cursorAuth/stripeMembershipType')"],
      { timeoutMs: 3000 },
    );
    if (result.exitCode !== 0) continue;

    const map = {};
    for (const line of result.stdout.trim().split("\n").filter(Boolean)) {
      const pipe = line.indexOf("|");
      if (pipe < 0) continue;
      map[line.slice(0, pipe)] = line.slice(pipe + 1);
    }

    const token = map["cursorAuth/accessToken"];
    if (!token) continue;

    return {
      accessToken: token,
      refreshToken: map["cursorAuth/refreshToken"] || "",
      planName: map["cursorAuth/stripeMembershipType"] || "",
    };
  }
  return null;
}

async function fetchKimiUsage(context) {
  let credentials = await readKimiCredentials(context);
  let token = credentials?.accessToken;
  let refreshMessage = null;

  // If the access token is stale, try to refresh it using the refresh_token.
  // We only update the access_token in the file; the refresh_token is left
  // untouched so the CLI continues to work.
  if (token && credentials?.refreshToken && credentials?.expiresAt && Date.now() > credentials.expiresAt * 1000) {
    try {
      const refreshed = await refreshKimiAccessToken(context, credentials);
      if (refreshed?.accessToken) {
        token = refreshed.accessToken;
        credentials = refreshed;
        refreshMessage = `Token refreshed ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      }
    } catch (e) {
      refreshMessage = `Token refresh failed: ${e?.message || e}`;
      // Fall through to the API call with the expired token
      // so the user sees the provider's error (e.g. 401 → "Sign in to Kimi").
    }
  }

  const result = await fetchProviderRows(context, providerByID.get("kimi"), token, {
    unauthenticated: "Sign in to Kimi",
    url: "https://api.kimi.com/coding/v1/usages",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    parse: parseKimiRows,
  });
  if (result && refreshMessage) result.refreshMessage = refreshMessage;
  return result;
}

async function readKimiCredentials(context) {
  for (const path of [`${context.home}/.kimi-code/credentials/kimi-code.json`, `${context.home}/.kimi/credentials/kimi-code.json`]) {
    const payload = parseJSON(await context.readText(path));
    const accessToken = jsonPath(payload, ["access_token"]);
    if (accessToken) {
      return {
        accessToken,
        refreshToken: jsonPath(payload, ["refresh_token"]),
        expiresAt: Number(jsonPath(payload, ["expires_at"])) || null,
        credentialPath: path,
      };
    }
  }
  return null;
}

async function refreshKimiAccessToken(context, credentials) {
  const response = await context.http({
    url: "https://auth.kimi.com/api/oauth/token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: `client_id=17e5f671-d194-4dfb-9706-5516cb48c098&grant_type=refresh_token&refresh_token=${encodeURIComponent(credentials.refreshToken)}`,
  });

  if (!response?.access_token) return null;

  const newAccessToken = response.access_token;
  const newExpiresIn = response.expires_in || 900;
  const newExpiresAt = Math.floor(Date.now() / 1000) + newExpiresIn;

  // Update only the access_token (and derived fields) in the credentials file.
  // The refresh_token is intentionally left untouched.
  const updatedPayload = JSON.stringify({
    access_token: newAccessToken,
    refresh_token: credentials.refreshToken,
    expires_at: newExpiresAt,
    expires_in: newExpiresIn,
    scope: response.scope || "kimi-code",
    token_type: response.token_type || "Bearer",
  });

  // Atomic write: write to a temp file, then rename.
  const tmpPath = `${credentials.credentialPath}.tmp`;
  await context.writeText(tmpPath, updatedPayload);
  await context.rename(tmpPath, credentials.credentialPath);

  return {
    accessToken: newAccessToken,
    refreshToken: credentials.refreshToken,
    expiresAt: newExpiresAt,
    credentialPath: credentials.credentialPath,
  };
}

async function fetchFactoryUsage(context) {
  const token = await firstString([
    context.env.FACTORY_ACCESS_TOKEN,
    context.env.FACTORY_API_TOKEN,
    readFactoryCredentialFile(context, `${context.home}/.factory/auth.json`),
    readFactoryCredentialFile(context, `${context.home}/.factory/auth.encrypted`),
    readFactoryKeychain(context),
  ]);
  return fetchProviderRows(context, providerByID.get("factory"), token, {
    unauthenticated: "Sign in to Factory",
    url: "https://api.factory.ai/api/organization/subscription/usage",
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: {},
    parse: parseFactoryRows,
  });
}

async function fetchGrokUsage(context) {
  const provider = providerByID.get("grok");
  const credentials = await readGrokCredentials(context);
  const token = credentials?.accessToken;
  if (!token) return unavailable(provider, "Sign in to Grok");

  try {
    const billingResp = await context.http({
      url: "https://cli-chat-proxy.grok.com/v1/billing",
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "X-XAI-Token-Auth": "xai-grok-cli", Accept: "application/json" },
    });

    const rows = parseGrokRows(billingResp);
    if (!Array.isArray(rows) || rows.length === 0) return unavailable(provider, "No usage data");

    // Best-effort plan name from settings
    let planName = "";
    try {
      const settingsResp = await context.http({
        url: "https://cli-chat-proxy.grok.com/v1/settings",
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "X-XAI-Token-Auth": "xai-grok-cli", Accept: "application/json" },
      });
      planName = settingsResp?.subscription_tier_display || "";
    } catch { /* settings is optional */ }

    return {
      id: provider.id, name: provider.name, icon: provider.icon,
      fetchedAt: new Date(), state: { kind: "available" }, rows,
      ...(planName ? { planName: formatPlanName(planName) } : {}),
    };
  } catch (error) {
    return unavailable(provider,
      error instanceof AuthError ? "Sign in to Grok" : "Unable to fetch usage",
      error instanceof AuthError ? "unavailable" : "error");
  }
}

async function readGrokCredentials(context) {
  const envToken = nonEmptyString(context.env.GROK_CODE_XAI_API_KEY) || nonEmptyString(context.env.XAI_API_KEY) || "";
  if (envToken) return { accessToken: envToken, refreshToken: "", planName: "" };

  const auth = parseJSON(await context.readText(`${context.home}/.grok/auth.json`));
  if (!auth || typeof auth !== "object") return null;

  for (const key of Object.keys(auth)) {
    const entry = auth[key];
    if (!entry || typeof entry !== "object") continue;
    const token = nonEmptyString(entry.key);
    if (token) {
      return {
        accessToken: token,
        refreshToken: nonEmptyString(entry.refresh_token) || nonEmptyString(entry.refresh) || "",
        planName: "",
        clientId: nonEmptyString(entry.oidc_client_id) || "b1a00492-073a-47ea-816f-4c329264a828",
      };
    }
  }
  return null;
}

async function fetchOpenCodeGoUsage(context) {
  const provider = providerByID.get("opencode-go");
  const credentials = await readOpenCodeGoCredentials(context);
  const token = credentials?.accessToken;
  if (!token) return unavailable(provider, "Sign in to OpenCode Go");

  try {
    const dbPath = `${context.home}/.local/share/opencode/opencode.db`;
    const dataSQL = `SELECT CAST(COALESCE(json_extract(data, '$.time.created'), time_created) AS INTEGER) AS createdMs, CAST(json_extract(data, '$.cost') AS REAL) AS cost FROM message WHERE json_valid(data) AND json_extract(data, '$.providerID') = 'opencode-go' AND json_extract(data, '$.role') = 'assistant' AND json_type(data, '$.cost') IN ('integer', 'real')`;

    const result = await context.exec(["/usr/bin/sqlite3", dbPath, "-separator", "|", dataSQL], { timeoutMs: 3000 });
    if (result.exitCode !== 0) return unavailable(provider, "No usage data");

    const rawRows = [];
    for (const line of result.stdout.trim().split("\n").filter(Boolean)) {
      const pipe = line.indexOf("|");
      if (pipe < 0) continue;
      const createdMs = Number(line.slice(0, pipe));
      const cost = Number(line.slice(pipe + 1));
      if (!Number.isFinite(createdMs) || !Number.isFinite(cost) || createdMs <= 0 || cost < 0) continue;
      rawRows.push({ createdMs, cost });
    }
    if (rawRows.length === 0) return unavailable(provider, "No usage data");

    const rows = parseOpenCodeGoRows(rawRows, Date.now());
    return {
      id: provider.id, name: provider.name, icon: provider.icon,
      fetchedAt: new Date(), state: { kind: "available" }, rows,
      planName: "Go",
    };
  } catch {
    return unavailable(provider, "Unable to fetch usage", "error");
  }
}

async function readOpenCodeGoCredentials(context) {
  const envToken = nonEmptyString(context.env.OPENCODE_GO_API_KEY) || "";
  if (envToken) return { accessToken: envToken };

  const auth = parseJSON(await context.readText(`${context.home}/.local/share/opencode/auth.json`));
  if (!auth || typeof auth !== "object") return null;

  const entry = auth["opencode-go"];
  if (!entry || typeof entry !== "object") return null;
  const key = nonEmptyString(entry.key);
  if (key) return { accessToken: key };

  return null;
}

async function fetchMiniMaxUsage(context) {
  const token = await firstString([
    context.env.MINIMAX_CN_API_KEY,
    context.env.MINIMAX_API_KEY,
    context.env.MINIMAX_API_TOKEN,
    readJSONPath(context, `${context.home}/.mmx/config.json`, ["api_key"]),
    readJSONPath(context, `${context.home}/.mmx/config.json`, ["apiKey"]),
    readJSONPath(context, `${context.home}/.mmx/config.json`, ["token"]),
    readJSONPath(context, `${context.home}/.mmx/credentials.json`, ["auth", "access_token"]),
  ]);
  const domains = context.env.MINIMAX_CN_API_KEY ? ["api.minimaxi.com"] : ["api.minimax.io", "www.minimax.io"];
  const endpointPath = context.env.MINIMAX_CN_API_KEY ? "/v1/token_plan/remains" : "/v1/api/openplatform/coding_plan/remains";
  for (const host of domains) {
    const snapshot = await fetchProviderRows(context, providerByID.get("minimax"), token, {
      unauthenticated: "Sign in to MiniMax",
      url: `https://${host}${endpointPath}`,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      parse: parseMiniMaxRows,
    });
    if (snapshot.state.kind !== "error") return snapshot;
  }
  return unavailable(providerByID.get("minimax"), "Unable to fetch usage");
}

async function fetchZaiUsage(context) {
  const provider = providerByID.get("zai");
  const token = context.env.ZAI_API_KEY || context.env.GLM_API_KEY || "";
  if (!token) return unavailable(provider, "Sign in to Z.ai");
  try {
    const [subscription, quota] = await Promise.all([
      context.http({ url: "https://api.z.ai/api/biz/subscription/list", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }),
      context.http({ url: "https://api.z.ai/api/monitor/usage/quota/limit", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }),
    ]);
    const planName = parseZaiPlanName(subscription);
    const rows = parseZaiRows(quota, planName);
    return rows.length > 0 ? { id: provider.id, name: provider.name, icon: provider.icon, fetchedAt: new Date(), state: { kind: "available" }, rows, planName } : unavailable(provider, "No usage data");
  } catch {
    return unavailable(provider, "Unable to fetch usage", "error");
  }
}

async function readClaudeCredentials(context) {
  // Priority: env var → file → keychain
  let accessToken = nonEmptyString(context.env.CLAUDE_CODE_OAUTH_TOKEN) || "";
  let subscriptionType = "";
  let rateLimitTier = "";
  let refreshToken = "";
  let expiresAt = null;
  let credentialPath = null;
  if (accessToken) return { accessToken, planName: "", refreshToken: "", expiresAt: null, credentialPath: null };

  // File
  const filePath = `${context.env.CLAUDE_CONFIG_DIR || `${context.home}/.claude`}/.credentials.json`;
  const fileRaw = await context.readText(filePath);
  const filePayload = parseJSON(fileRaw);
  if (filePayload?.claudeAiOauth) {
    const oauth = filePayload.claudeAiOauth;
    accessToken = oauth.accessToken || "";
    refreshToken = oauth.refreshToken || "";
    expiresAt = oauth.expiresAt || null;
    subscriptionType = oauth.subscriptionType || "";
    rateLimitTier = oauth.rateLimitTier || "";
    credentialPath = filePath;
  }

  if (!accessToken) {
    // Keychain
    const raw = await context.keychain("Claude Code-credentials", context.env.USER || "");
    const payload = parseJSON(raw);
    if (payload?.claudeAiOauth) {
      const oauth = payload.claudeAiOauth;
      accessToken = oauth.accessToken || "";
      refreshToken = refreshToken || oauth.refreshToken || "";
      expiresAt = expiresAt || oauth.expiresAt || null;
      subscriptionType = subscriptionType || oauth.subscriptionType || "";
      rateLimitTier = rateLimitTier || oauth.rateLimitTier || "";
      // keychain-sourced credentials can't be atomically written back with current primitives
    }
  }

  const plan = subscriptionType && rateLimitTier ? `${subscriptionType} ${rateLimitTier}` : subscriptionType || rateLimitTier || "";
  return { accessToken, planName: plan, refreshToken, expiresAt, credentialPath };
}

async function readCodexAuth(context) {
  if (context.env.CODEX_ACCESS_TOKEN) {
    return { accessToken: context.env.CODEX_ACCESS_TOKEN, accountID: context.env.CODEX_ACCOUNT_ID || "" };
  }
  for (const path of [context.env.CODEX_HOME && `${context.env.CODEX_HOME}/auth.json`, `${context.home}/.config/codex/auth.json`, `${context.home}/.codex/auth.json`].filter(Boolean)) {
    const payload = parseJSON(await context.readText(path));
    const accessToken = jsonPath(payload, ["tokens", "access_token"]);
    if (accessToken) return { accessToken, accountID: jsonPath(payload, ["tokens", "account_id"]) || "" };
  }
  return null;
}

async function readCopilotHostsToken(context) {
  const payload = parseJSON(await context.readText(`${context.home}/.config/github-copilot/hosts.json`));
  for (const host of Object.values(payload || {})) {
    const token = jsonPath(host, ["oauth_token"]) || jsonPath(host, ["token"]) || jsonPath(host, ["github_token"]);
    if (token) return token;
  }
  return "";
}

async function readGHHostsToken(context) {
  const text = await context.readText(`${context.home}/.config/gh/hosts.yml`);
  const match = text.match(/(?:^|\n)\s*oauth_token:\s*['"]?([^'"\n]+)['"]?/);
  return match?.[1]?.trim() || "";
}

async function readFactoryCredentialFile(context, path) {
  return tokenFromCredentialRaw(await context.readText(path));
}

async function readFactoryKeychain(context) {
  for (const service of ["Factory Token", "Factory token", "Factory Auth", "Droid Auth"]) {
    const token = tokenFromCredentialRaw(await context.keychain(service));
    if (token) return token;
  }
  return "";
}

function tokenFromCredentialRaw(raw) {
  const trimmed = nonEmptyString(raw);
  if (!trimmed) return "";
  const payload = parseJSON(trimmed) || parseJSON(hexDecode(trimmed));
  if (!payload) return trimmed.split(".").length >= 3 ? trimmed : "";
  return jsonPath(payload, ["tokens", "access_token"])
    || jsonPath(payload, ["tokens", "accessToken"])
    || jsonPath(payload, ["access_token"])
    || jsonPath(payload, ["accessToken"]);
}

function hexDecode(value) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return "";
  return String.fromCharCode(...value.match(/.{2}/g).map((pair) => Number.parseInt(pair, 16)));
}
