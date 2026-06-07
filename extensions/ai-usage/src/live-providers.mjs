import { nonEmptyString } from "./values.mjs";
import { providerCatalog } from "./providers.mjs";
import { fetchProviderRows, firstString, jsonPath, parseJSON, readJSONPath, unavailable } from "./live-runtime.mjs";
import { parseAmpRows, parseClaudeRows, parseCodexRows, parseCopilotRows, parseFactoryRows, parseKimiRows, parseMiniMaxRows, parseZaiPlanName, parseZaiRows } from "./live-parsers.mjs";

const providerByID = new Map(providerCatalog.map((provider) => [provider.id, provider]));

export const providerFetchers = [
  { id: "claude", fetch: fetchClaudeUsage },
  { id: "codex", fetch: fetchCodexUsage },
  { id: "amp", fetch: fetchAmpUsage },
  { id: "copilot", fetch: fetchCopilotUsage },
  { id: "factory", fetch: fetchFactoryUsage },
  { id: "kimi", fetch: fetchKimiUsage },
  { id: "minimax", fetch: fetchMiniMaxUsage },
  { id: "zai", fetch: fetchZaiUsage },
];

async function fetchClaudeUsage(context) {
  const token = await firstString([
    context.env.CLAUDE_CODE_OAUTH_TOKEN,
    readJSONPath(context, `${context.env.CLAUDE_CONFIG_DIR || `${context.home}/.claude`}/.credentials.json`, ["claudeAiOauth", "accessToken"]),
    readClaudeKeychain(context),
  ]);
  return fetchProviderRows(context, providerByID.get("claude"), token, {
    unauthenticated: "Sign in to Claude",
    url: "https://api.anthropic.com/api/oauth/usage",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", "anthropic-beta": "oauth-2025-04-20" },
    parse: parseClaudeRows,
  });
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
    body: { method: "usage" },
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

async function fetchKimiUsage(context) {
  const credentials = await readKimiCredentials(context);
  const token = credentials?.accessToken;

  // Skip API call and show "Token expired" if the token is stale.
  // We intentionally do NOT refresh here: doing so would rotate the
  // refresh_token on the server and invalidate the CLI's copy.
  if (token && credentials?.expiresAt && Date.now() > credentials.expiresAt * 1000) {
    return unavailable(providerByID.get("kimi"), "Token expired, run `kimi login`");
  }

  return fetchProviderRows(context, providerByID.get("kimi"), token, {
    unauthenticated: "Sign in to Kimi",
    url: "https://api.kimi.com/coding/v1/usages",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    parse: (payload) => parseKimiRows(payload).rows,
  });
}

async function readKimiCredentials(context) {
  for (const path of [`${context.home}/.kimi-code/credentials/kimi-code.json`, `${context.home}/.kimi/credentials/kimi-code.json`]) {
    const payload = parseJSON(await context.readText(path));
    const accessToken = jsonPath(payload, ["access_token"]);
    if (accessToken) {
      return {
        accessToken,
        expiresAt: Number(jsonPath(payload, ["expires_at"])) || null,
      };
    }
  }
  return null;
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
    parse: (payload) => parseFactoryRows(payload).rows,
  });
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
  for (const host of domains) {
    const snapshot = await fetchProviderRows(context, providerByID.get("minimax"), token, {
      unauthenticated: "Sign in to MiniMax",
      url: `https://${host}/v1/api/openplatform/coding_plan/remains`,
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
    const rows = parseZaiRows(quota, parseZaiPlanName(subscription));
    return rows.length > 0 ? { id: provider.id, name: provider.name, icon: provider.icon, fetchedAt: new Date(), state: { kind: "available" }, rows } : unavailable(provider, "No usage data");
  } catch {
    return unavailable(provider, "Unable to fetch usage", "error");
  }
}

async function readClaudeKeychain(context) {
  const raw = await context.keychain("Claude Code-credentials", context.env.USER || "");
  return jsonPath(parseJSON(raw), ["claudeAiOauth", "accessToken"]);
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
