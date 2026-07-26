import { nonEmptyString } from "./values.mjs";

const curlBinary = "/usr/bin/curl";
const envTimeoutMs = 3000;
const readTimeoutMs = 3000;
const httpTimeoutMs = 25000;

export class AuthError extends Error {}

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
    return unavailable(provider, error instanceof AuthError ? request.unauthenticated : "Unable to fetch usage", error instanceof AuthError ? "unavailable" : "error");
  }
}

export function unavailable(provider, message, kind = "unavailable") {
  return snapshot(provider, kind, [], message);
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

async function httpJSON(exec, request) {
  const result = await exec(
    [curlBinary, "--silent", "--show-error", "--location", "--max-time", "20", "--write-out", "\n%{http_code}", "--config", "-"],
    { stdin: curlConfig(request), timeoutMs: httpTimeoutMs },
  );
  if (result.exitCode !== 0) throw new Error(`request failed (curl exit ${result.exitCode})`);
  const trimmed = result.stdout.trimEnd();
  const split = trimmed.lastIndexOf("\n");
  if (split < 0) throw new Error("missing status");
  const status = Number(trimmed.slice(split + 1));
  if (status === 401 || status === 403) throw new AuthError();
  if (!Number.isFinite(status) || status < 200 || status >= 300) throw new Error(`request failed (HTTP ${status})`);
  return JSON.parse(trimmed.slice(0, split) || "{}");
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
