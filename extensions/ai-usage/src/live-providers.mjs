import { nonEmptyString } from "./values.mjs";
import { providerCatalog } from "./providers.mjs";
import { AuthError, fetchProviderRows, firstString, formatPlanName, jsonPath, parseJSON, readJSONPath, unavailable } from "./live-runtime.mjs";
import { parseAmpRows, parseAntigravityRows, parseClaudeRows, parseCodexRows, parseCopilotRows, parseCursorRows, parseDevinRows, parseFactoryRows, parseGrokRows, parseKimiRows, parseMiniMaxRows, parseOpenCodeGoRows, parseOpenRouterCreditsRows, parseOpenRouterKeyRows, parseZaiPlanName, parseZaiRows } from "./live-parsers.mjs";

const providerByID = new Map(providerCatalog.map((provider) => [provider.id, provider]));

export const providerFetchers = [
  { id: "antigravity", fetch: fetchAntigravityUsage },
  { id: "claude", fetch: fetchClaudeUsage },
  { id: "codex", fetch: fetchCodexUsage },
  { id: "amp", fetch: fetchAmpUsage },
  { id: "copilot", fetch: fetchCopilotUsage },
  { id: "cursor", fetch: fetchCursorUsage },
  { id: "devin", fetch: fetchDevinUsage },
  { id: "factory", fetch: fetchFactoryUsage },
  { id: "grok", fetch: fetchGrokUsage },
  { id: "openrouter", fetch: fetchOpenRouterUsage },
  { id: "opencode-go", fetch: fetchOpenCodeGoUsage },
  { id: "kimi", fetch: fetchKimiUsage },
  { id: "minimax", fetch: fetchMiniMaxUsage },
  { id: "zai", fetch: fetchZaiUsage },
];

async function fetchAntigravityUsage(context) {
  const provider = providerByID.get("antigravity");
  const credentials = await readAntigravityCredentials(context);
  if (!credentials?.accessToken) return unavailable(provider, "Start Antigravity or run agy");

  const refreshed = await refreshAntigravityTokenIfNeeded(context, credentials);
  const token = refreshed?.accessToken || credentials.accessToken;
  const planName = refreshed?.planName || credentials.planName || "";
  for (const baseURL of ["https://daily-cloudcode-pa.googleapis.com", "https://cloudcode-pa.googleapis.com"]) {
    try {
      const payload = await context.http({
        url: `${baseURL}/v1internal:retrieveUserQuotaSummary`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "antigravity",
        },
        body: {},
      });
      const rows = parseAntigravityRows(payload);
      if (rows.length > 0) return { id: provider.id, name: provider.name, icon: provider.icon, fetchedAt: new Date(), state: { kind: "available" }, rows, ...(planName ? { planName } : {}) };
    } catch {
      // Try the next Cloud Code base URL.
    }
  }
  return unavailable(provider, "Unable to fetch usage", "error");
}

async function fetchClaudeUsage(context) {
  const provider = providerByID.get("claude");
  const candidates = await readClaudeCredentialCandidates(context);
  if (candidates.length === 0) return unavailable(provider, "Sign in to Claude");

  let authFallback = null;
  for (const credentials of candidates) {
    const result = await fetchClaudeCredentialUsage(context, provider, credentials);
    if (result.state.kind === "available") return result;
    if (result.state.kind === "unavailable" && result.state.message === "Sign in to Claude") {
      authFallback = result;
      continue;
    }
    return result;
  }
  return authFallback || unavailable(provider, "Sign in to Claude");
}

async function fetchClaudeCredentialUsage(context, provider, credentials) {
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
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", "anthropic-beta": "oauth-2025-04-20", "User-Agent": "claude-code/2.1.69" },
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

async function fetchDevinUsage(context) {
  const provider = providerByID.get("devin");
  const credentials = await readDevinCredentials(context);
  if (!credentials?.apiKey) return unavailable(provider, "Run devin auth login");
  try {
    const payload = await context.http({
      url: `${credentials.apiServerURL}/exa.seat_management_pb.SeatManagementService/GetUserStatus`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: {
        metadata: {
          apiKey: credentials.apiKey,
          ideName: "devin",
          ideVersion: "1.108.2",
          extensionName: "devin",
          extensionVersion: "1.108.2",
          locale: "en",
        },
      },
    });
    const result = parseDevinRows(payload);
    return result.rows.length > 0 ? { id: provider.id, name: provider.name, icon: provider.icon, fetchedAt: new Date(), state: { kind: "available" }, rows: result.rows, planName: result.planName } : unavailable(provider, "No usage data");
  } catch {
    return unavailable(provider, "Unable to fetch usage", "error");
  }
}

async function readDevinCredentials(context) {
  const envKey = nonEmptyString(context.env.DEVIN_API_KEY) || nonEmptyString(context.env.WINDSURF_API_KEY);
  if (envKey) return { apiKey: envKey, apiServerURL: "https://server.codeium.com" };

  const text = await context.readText(`${context.home}/.local/share/devin/credentials.toml`);
  const fileKey = readTomlString(text, "windsurf_api_key");
  if (fileKey) {
    return {
      apiKey: fileKey,
      apiServerURL: cleanURL(readTomlString(text, "api_server_url")) || "https://server.codeium.com",
    };
  }

  const dbPath = `${context.home}/Library/Application Support/Devin/User/globalStorage/state.vscdb`;
  const result = await context.exec(["/usr/bin/sqlite3", dbPath, "SELECT value FROM ItemTable WHERE key = 'windsurfAuthStatus' LIMIT 1"], { timeoutMs: 3000 });
  if (result.exitCode === 0) {
    const payload = parseJSON(result.stdout.trim());
    const apiKey = nonEmptyString(payload?.apiKey);
    if (apiKey) return { apiKey, apiServerURL: "https://server.codeium.com" };
  }
  return null;
}

async function fetchKimiUsage(context) {
  let credentials = await readKimiCredentials(context);
  let token = credentials?.accessToken;
  let refreshMessage = null;

  // If the access token is stale, try to refresh it using the refresh_token.
  // The refresh_token is also updated if the server rotates it.
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

async function fetchOpenRouterUsage(context) {
  const provider = providerByID.get("openrouter");
  const apiKey = await readOpenRouterKey(context);
  if (!apiKey) return unavailable(provider, "Set OPENROUTER_API_KEY");
  try {
    const [credits, key] = await Promise.all([
      context.http({ url: "https://openrouter.ai/api/v1/credits", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }),
      context.http({ url: "https://openrouter.ai/api/v1/key", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }).catch(() => null),
    ]);
    const creditRows = parseOpenRouterCreditsRows(credits);
    const keyResult = key ? parseOpenRouterKeyRows(key) : { rows: [], planName: "" };
    const rows = [...creditRows, ...keyResult.rows];
    return rows.length > 0 ? { id: provider.id, name: provider.name, icon: provider.icon, fetchedAt: new Date(), state: { kind: "available" }, rows, ...(keyResult.planName ? { planName: keyResult.planName } : {}) } : unavailable(provider, "No usage data");
  } catch {
    return unavailable(provider, "Unable to fetch usage", "error");
  }
}

async function readOpenRouterKey(context) {
  const envKey = nonEmptyString(context.env.OPENROUTER_API_KEY) || nonEmptyString(context.env.OPENROUTER_KEY);
  if (envKey) return envKey;
  for (const path of [`${context.home}/.config/openusage/openrouter.json`, `${context.home}/.config/openrouter/key.json`]) {
    const raw = await context.readText(path);
    const payload = parseJSON(raw);
    const key = nonEmptyString(payload?.apiKey) || nonEmptyString(payload?.api_key) || nonEmptyString(payload?.key) || nonEmptyString(raw);
    if (key) return key;
  }
  return "";
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

  // Update the access_token (and derived fields) in the credentials file.
  // If the server returns a new refresh_token (rotation), use it.
  const newRefreshToken = response.refresh_token || credentials.refreshToken;
  const updatedPayload = JSON.stringify({
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
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
    refreshToken: newRefreshToken,
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
      url: "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
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
  const credentials = await readZaiCredentials(context);
  if (!credentials.token) return unavailable(provider, "SET ZAI_API_KEY");
  const headers = { Authorization: credentials.authorization, Accept: "application/json" };
  try {
    const [subscription, quota] = await Promise.all([
      context.http({ url: `${credentials.baseURL}/api/biz/subscription/list`, headers }),
      context.http({ url: `${credentials.baseURL}/api/monitor/usage/quota/limit`, headers }),
    ]);
    const planName = parseZaiPlanName(subscription);
    const rows = parseZaiRows(quota, planName);
    return rows.length > 0 ? { id: provider.id, name: provider.name, icon: provider.icon, fetchedAt: new Date(), state: { kind: "available" }, rows, planName } : unavailable(provider, "No usage data");
  } catch {
    return unavailable(provider, "Unable to fetch usage", "error");
  }
}

async function readZaiCredentials(context) {
  const token = nonEmptyString(context.env.ZAI_API_KEY) || await readZaiShellToken(context);
  return { token, authorization: token ? bearerAuthorization(token) : "", baseURL: "https://api.z.ai" };
}

async function readZaiShellToken(context) {
  const shell = loginShellBinary(context.env.SHELL);
  const marker = "__MUXY_ZAI_API_KEY__";
  try {
    const result = await context.exec([shell, "-lic", `printf '\\n${marker}%s' "$ZAI_API_KEY"`], { timeoutMs: 3000 });
    if (result.exitCode !== 0) return "";
    const output = String(result.stdout || "");
    const index = output.lastIndexOf(marker);
    return index < 0 ? "" : nonEmptyString(output.slice(index + marker.length)) || "";
  } catch {
    return "";
  }
}

function loginShellBinary(value) {
  const shell = nonEmptyString(value);
  return shell && shell.startsWith("/") && !shell.includes("\n") ? shell : "/bin/zsh";
}

function bearerAuthorization(token) {
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

async function readAntigravityCredentials(context) {
  const envToken = nonEmptyString(context.env.ANTIGRAVITY_ACCESS_TOKEN) || "";
  if (envToken) return { accessToken: envToken, refreshToken: "", expiresAt: null, planName: "" };

  const cached = parseJSON(await context.readText(`${context.home}/Library/Application Support/OpenUsage/antigravity/auth.json`));
  if (cached?.accessToken && Number(cached.expiresAtMs) > Date.now() + 60000) {
    return { accessToken: cached.accessToken, refreshToken: "", expiresAt: Number(cached.expiresAtMs), planName: "" };
  }

  const raw = await context.keychain("gemini", "antigravity");
  const token = antigravityTokenFromRaw(raw);
  if (!token) return null;
  return token;
}

async function refreshAntigravityTokenIfNeeded(context, credentials) {
  if (!credentials.refreshToken || !credentials.expiresAt || credentials.expiresAt > Date.now() + 60000) return credentials;
  if (!credentials.clientId || !credentials.clientSecret) return credentials;
  try {
    const response = await context.http({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: [
        ["client_id", credentials.clientId],
        ["client_secret", credentials.clientSecret],
        ["refresh_token", credentials.refreshToken],
        ["grant_type", "refresh_token"],
      ].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&"),
    });
    if (!response?.access_token) return credentials;
    return {
      accessToken: response.access_token,
      refreshToken: credentials.refreshToken,
      expiresAt: Date.now() + (response.expires_in || 3600) * 1000,
      planName: credentials.planName || "",
    };
  } catch {
    return credentials;
  }
}

function antigravityTokenFromRaw(raw) {
  const text = unwrapGoKeyring(raw);
  if (!text) return null;
  const payload = parseJSON(text);
  if (payload && typeof payload === "object") return antigravityTokenFromObject(payload);
  const token = text.replace(/^Bearer\s+/i, "").trim();
  return token ? { accessToken: token, refreshToken: "", expiresAt: null, planName: "" } : null;
}

function antigravityTokenFromObject(object) {
  const source = object.token && typeof object.token === "object" ? object.token : object;
  const accessToken = firstObjectString(source, ["access_token", "accessToken", "token", "id_token", "idToken", "bearerToken", "auth_token", "authToken"]);
  const refreshToken = firstObjectString(source, ["refresh_token", "refreshToken"]);
  const clientId = firstObjectString(source, ["client_id", "clientId", "oauth_client_id", "oauthClientId"]);
  const clientSecret = firstObjectString(source, ["client_secret", "clientSecret", "oauth_client_secret", "oauthClientSecret"]);
  const expiryRaw = firstObjectString(source, ["expiry", "expires_at", "expiresAt"]);
  const expiresAt = expiryRaw ? Date.parse(expiryRaw) : null;
  if (accessToken || refreshToken) return { accessToken, refreshToken, clientId, clientSecret, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null, planName: "" };
  for (const key of ["tokens", "oauth", "oauth2", "credentials", "auth"]) {
    if (object[key] && typeof object[key] === "object") {
      const nested = antigravityTokenFromObject(object[key]);
      if (nested) return nested;
    }
  }
  return null;
}

function unwrapGoKeyring(raw) {
  const text = nonEmptyString(raw);
  if (!text) return "";
  if (!text.startsWith("go-keyring-base64:")) return text;
  const encoded = text.slice("go-keyring-base64:".length);
  try {
    if (typeof atob === "function") return atob(encoded);
  } catch {
    // Fall through to Buffer.
  }
  try {
    return typeof Buffer === "undefined" ? "" : Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function firstObjectString(object, keys) {
  for (const key of keys) {
    const value = nonEmptyString(object?.[key]);
    if (value) return value;
  }
  return "";
}

function readTomlString(text, key) {
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0 || trimmed.slice(0, index).trim() !== key) continue;
    let value = trimmed.slice(index + 1).trim();
    if (!value) return "";
    const quote = value[0];
    if (quote === "\"" || quote === "'") {
      const end = value.indexOf(quote, 1);
      return end > 0 ? value.slice(1, end).trim() : "";
    }
    const comment = value.indexOf("#");
    if (comment >= 0) value = value.slice(0, comment).trim();
    return value;
  }
  return "";
}

function cleanURL(value) {
  const text = nonEmptyString(value);
  if (!text || !text.startsWith("https://")) return "";
  return text.replace(/\/+$/, "");
}

async function readClaudeCredentialCandidates(context) {
  const candidates = [];
  const keychain = await readClaudeKeychainCredentials(context);
  if (keychain?.accessToken) candidates.push(keychain);
  const file = await readClaudeFileCredentials(context);
  if (file?.accessToken) candidates.push(file);
  const envToken = nonEmptyString(context.env.CLAUDE_CODE_OAUTH_TOKEN) || "";
  if (envToken && candidates.length === 0) candidates.push({ accessToken: envToken, planName: "", refreshToken: "", expiresAt: null, credentialPath: null });
  return candidates;
}

async function readClaudeFileCredentials(context) {
  let subscriptionType = "";
  let rateLimitTier = "";
  let refreshToken = "";
  let expiresAt = null;
  const filePath = `${context.env.CLAUDE_CONFIG_DIR || `${context.home}/.claude`}/.credentials.json`;
  const fileRaw = await context.readText(filePath);
  const filePayload = parseJSON(fileRaw);
  const oauth = filePayload?.claudeAiOauth;
  if (!oauth?.accessToken) return null;
  subscriptionType = oauth.subscriptionType || "";
  rateLimitTier = oauth.rateLimitTier || "";
  refreshToken = oauth.refreshToken || "";
  expiresAt = oauth.expiresAt || null;
  return {
    accessToken: oauth.accessToken,
    planName: formatClaudeCredentialPlan(subscriptionType, rateLimitTier),
    refreshToken,
    expiresAt,
    credentialPath: filePath,
  };
}

async function readClaudeKeychainCredentials(context) {
  for (const account of [context.env.USER || "", ""]) {
    const raw = await context.keychain("Claude Code-credentials", account);
    const payload = parseJSON(raw);
    if (payload?.claudeAiOauth) {
      const oauth = payload.claudeAiOauth;
      if (oauth.accessToken) {
        return {
          accessToken: oauth.accessToken,
          planName: formatClaudeCredentialPlan(oauth.subscriptionType || "", oauth.rateLimitTier || ""),
          refreshToken: oauth.refreshToken || "",
          expiresAt: oauth.expiresAt || null,
          credentialPath: null,
        };
      }
    }
  }
  return null;
}

function formatClaudeCredentialPlan(subscriptionType, rateLimitTier) {
  const subscription = normalizeClaudePlanText(subscriptionType);
  const tier = normalizeClaudeTierSuffix(rateLimitTier);
  if (subscription && tier) return `${subscription} ${tier}`;
  return subscription || normalizeClaudePlanText(rateLimitTier);
}

function normalizeClaudePlanText(value) {
  const text = nonEmptyString(value);
  if (!text) return "";
  const normalized = text
    .replace(/^default_c(?:alude|laude)_/i, "")
    .replace(/^claude[_\s-]+/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.replace(/\b([a-z])/g, (match) => match.toUpperCase()).replace(/\b(\d+)x\b/gi, (_, value) => `${value}x`);
}

function normalizeClaudeTierSuffix(value) {
  const text = nonEmptyString(value);
  if (!text) return "";
  const match = text.match(/(?:^|_)(\d+x)$/i);
  return match ? match[1].toLowerCase() : "";
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
