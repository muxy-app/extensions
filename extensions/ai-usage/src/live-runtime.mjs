import { nonEmptyString } from "./values.mjs";

const curlBinary = "/usr/bin/curl";
const envTimeoutMs = 3000;
const readTimeoutMs = 3000;
const httpTimeoutMs = 25000;

export class AuthError extends Error {}

export class RateLimitError extends Error {
  constructor(retryAt) {
    super("rate limited");
    this.retryAt = retryAt;
  }
}

const defaultRateLimitMs = 5 * 60 * 1000;
const rateLimitedUntil = new Map();

export async function makeRuntimeContext(exec) {
  const env = await readEnvironment(exec);
  return {
    env,
    home: env.HOME || "~",
    exec,
    readText: (path) => readText(exec, expandHome(path, env.HOME), readTimeoutMs),
    writeText: (path, text) => writeText(exec, expandHome(path, env.HOME), text, readTimeoutMs),
    rename: (from, to) => renameFile(exec, expandHome(from, env.HOME), expandHome(to, env.HOME), readTimeoutMs),
    keychain: (service, account = "") => readKeychain(exec, service, account),
    http: (request) => httpJSON(exec, request),
  };
}

export async function fetchProviderRows(context, provider, token, request) {
  if (!provider) return null;
  if (!token) return unavailable(provider, request.unauthenticated);
  try {
    const payload = await context.http(request);
    const result = request.parse(payload);
    const rows = result?.rows ?? result;
    if (!Array.isArray(rows) || rows.length === 0) return unavailable(provider, "No usage data");
    return snapshot(provider, "available", rows, "", formatPlanName(result?.planName || request.planName || ""));
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimited(provider, error.retryAt);
    return unavailable(provider, error instanceof AuthError ? request.unauthenticated : "Unable to fetch usage", error instanceof AuthError ? "unavailable" : "error");
  }
}

export function unavailable(provider, message, kind = "unavailable") {
  return snapshot(provider, kind, [], message);
}

export function rateLimited(provider, retryAt) {
  return { ...snapshot(provider, "error", [], `Rate limited until ${formatClock(retryAt)}`), rateLimitedUntil: new Date(retryAt) };
}

export function formatClock(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export async function readJSONPath(context, path, keys) {
  return jsonPath(parseJSON(await context.readText(path)), keys);
}

export async function firstString(candidates) {
  for (const candidate of candidates) {
    const value = nonEmptyString(candidate instanceof Promise ? await candidate : candidate);
    if (value) return value;
  }
  return "";
}

const KNOWN_PLAN_NAMES = {
  prolite: "Pro Lite",
  pro: "Pro",
  enterprise: "Enterprise",
  business: "Business",
  max: "Max",
  team: "Team",
  plus: "Plus",
  hobby: "Hobby",
  starter: "Starter",
  free: "Free",
  personal: "Personal",
};

export function formatPlanName(name) {
  if (!name) return "";
  const lower = String(name).toLowerCase();
  return KNOWN_PLAN_NAMES[lower] || name.charAt(0).toUpperCase() + name.slice(1);
}

export function parseJSON(raw) {
  try {
    return JSON.parse(String(raw || ""));
  } catch {
    return null;
  }
}

export function jsonPath(value, keys) {
  let current = value;
  for (const key of keys) {
    current = current?.[key];
  }
  return nonEmptyString(current) || "";
}

function snapshot(provider, state, rows = [], message = "", planName) {
  return {
    id: provider.id,
    name: provider.name,
    icon: provider.icon,
    fetchedAt: new Date(),
    state: state === "available" ? { kind: "available" } : { kind: state, message },
    rows,
    ...(planName ? { planName } : {}),
  };
}

async function readEnvironment(exec) {
  const result = await exec(["/usr/bin/env"], { timeoutMs: envTimeoutMs });
  if (result.exitCode !== 0) return {};
  return Object.fromEntries(result.stdout.split("\n").flatMap((line) => {
    const index = line.indexOf("=");
    if (index <= 0) return [];
    return [[line.slice(0, index), line.slice(index + 1)]];
  }));
}

async function readText(exec, path, timeoutMs) {
  const result = await exec(["/bin/cat", path], { timeoutMs });
  return result.exitCode === 0 ? result.stdout : "";
}

async function writeText(exec, path, text, timeoutMs) {
  const result = await exec(["/bin/sh", "-c", `cat > '${path.replace(/'/g, "'\"'\"'")}'`], { stdin: text, timeoutMs });
  if (result.exitCode !== 0) throw new Error("write failed");
}

async function renameFile(exec, fromPath, toPath, timeoutMs) {
  const result = await exec(["/bin/mv", "-f", fromPath, toPath], { timeoutMs });
  if (result.exitCode !== 0) throw new Error("rename failed");
}

async function readKeychain(exec, service, account) {
  const argv = ["/usr/bin/security", "find-generic-password", "-s", service, "-w"];
  if (account) argv.splice(2, 0, "-a", account);
  const result = await exec(argv, { timeoutMs: readTimeoutMs });
  return result.exitCode === 0 ? result.stdout.trim() : "";
}

/*
 * 변경 전 정책: HTTP 429도 일반 실패로 처리해 "Unable to fetch usage"를 표시했고, 다음 refresh에서
 *   곧바로 같은 endpoint를 다시 호출했다.
 * 변경 후 정책: 429면 retry-after(없거나 0이면 5분)까지 해당 host 호출을 건너뛰고 RateLimitError를 던진다.
 * 변경 이유: Claude의 /api/oauth/usage는 계정 단위로 강하게 rate limit되어, 제한 중 재호출이 잠금을
 *   연장하고 사용량 표시가 오류로 바뀌었다.
 * 영향 범위: context.http를 쓰는 모든 provider. 같은 popover/background 런타임 안에서만 host별
 *   쿨다운을 기억하며, 429가 아닌 응답 처리는 그대로다.
 */
async function httpJSON(exec, request) {
  const host = requestHost(request.url);
  const cooldownUntil = rateLimitedUntil.get(host) || 0;
  if (Date.now() < cooldownUntil) throw new RateLimitError(cooldownUntil);
  const result = await exec(
    [curlBinary, "--silent", "--show-error", "--location", "--max-time", "20", "--write-out", "\n%{http_code} %header{retry-after}", "--config", "-"],
    { stdin: curlConfig(request), timeoutMs: httpTimeoutMs },
  );
  if (result.exitCode !== 0) throw new Error(`request failed (curl exit ${result.exitCode})`);
  const trimmed = result.stdout.trimEnd();
  const split = trimmed.lastIndexOf("\n");
  if (split < 0) throw new Error("missing status");
  const [statusText, retryAfter = ""] = trimmed.slice(split + 1).trim().split(/\s+/);
  const status = Number(statusText);
  if (status === 429) {
    const retryAt = Date.now() + retryAfterMs(retryAfter);
    rateLimitedUntil.set(host, retryAt);
    throw new RateLimitError(retryAt);
  }
  if (status === 401 || status === 403) throw new AuthError();
  if (!Number.isFinite(status) || status < 200 || status >= 300) throw new Error(`request failed (HTTP ${status})`);
  return JSON.parse(trimmed.slice(0, split) || "{}");
}

function requestHost(url) {
  return String(url).split("/")[2] || String(url);
}

function retryAfterMs(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date) && date > Date.now()) return date - Date.now();
  return defaultRateLimitMs;
}

function curlConfig({ url, method = "GET", headers = {}, body = null }) {
  const lines = [`url = "${escapeCurl(url)}"`, `request = "${escapeCurl(method)}"`];
  for (const [key, value] of Object.entries(headers)) {
    lines.push(`header = "${escapeCurl(`${key}: ${value}`)}"`);
  }
  if (body !== null) lines.push(`data = "${escapeCurl(typeof body === "string" ? body : JSON.stringify(body))}"`);
  return `${lines.join("\n")}\n`;
}

function escapeCurl(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n");
}

function expandHome(path, home) {
  return String(path).startsWith("~/") ? `${home}${String(path).slice(1)}` : String(path);
}
