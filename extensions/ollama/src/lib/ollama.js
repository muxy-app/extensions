export const POLL_MS = 10000;
export const VERSION_MAX_TIME = "2";
export const TAGS_MAX_TIME = "3";
export const PROBE_TIMEOUT_MS = 5000;
export const HELP_TIMEOUT_MS = 8000;
export const DEFAULT_SERVER = { name: "Local", url: "http://127.0.0.1:11434" };

export function makeId() {
  return `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeBaseUrl(raw) {
  let value = String(raw || "").trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.host) return null;
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

export function hostLabel(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url || "")
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/\/.*$/, "");
  }
}

export function safeJsonParse(text) {
  try {
    const value = JSON.parse(String(text || ""));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function errMessage(err, limit = 140) {
  const message = String(err?.message || err || "request failed").trim();
  return message.length > limit ? `${message.slice(0, limit - 1)}…` : message;
}

export function isMissingBinary(message) {
  const text = String(message || "");
  if (/denied|consent|permission/i.test(text)) return false;
  return /not found|enoent|failed to launch|no such file/i.test(text);
}

export function parseIntegrations(stdout) {
  const lines = String(stdout || "").split("\n");
  const start = lines.findIndex((line) => line.trim() === "Supported integrations:");
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    // The region ends at the first non-indented structural line ("Examples:", "Usage:" …).
    if (!/^\s/.test(line)) break;
    const match = line.match(/^\s+([A-Za-z0-9][A-Za-z0-9._-]*)\s+(.+?)\s*$/);
    // Tolerate indented lines that are not integrations (a flag, a stray caption) rather
    // than stopping, so one malformed line can't silently truncate the rest of the list.
    if (!match) continue;
    const name = match[1];
    let label = match[2];
    const aliases = [];
    const alias = label.match(/\((?:alias|aliases):\s*([^)]+)\)\s*$/);
    if (alias) {
      for (const item of alias[1].split(",")) {
        const value = item.trim();
        if (value) aliases.push(value);
      }
      label = label.slice(0, alias.index).trim();
    }
    out.push({ name, label: label || name, aliases });
  }
  return out;
}

export function parseModels(stdout) {
  const payload = safeJsonParse(stdout);
  const list = Array.isArray(payload?.models) ? payload.models : [];
  return list
    .map((model) => ({
      name: String(model?.name || ""),
      size: Number(model?.size) || 0,
      parameterSize: model?.details?.parameter_size || "",
      quantization: model?.details?.quantization_level || "",
    }))
    .filter((model) => model.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

export function modelSubtitle(model) {
  return [model.parameterSize, model.quantization, formatBytes(model.size)]
    .filter(Boolean)
    .join(" · ");
}

export function filterModels(models, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return models;
  return models.filter((model) => model.name.toLowerCase().includes(needle));
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function buildLaunchCommand({ url, agent, model, extraArgs }) {
  const parts = [`OLLAMA_HOST=${shellQuote(url)}`, "ollama", "launch", shellQuote(agent)];
  if (model) parts.push("--model", shellQuote(model));
  const extra = String(extraArgs || "").trim();
  if (extra) parts.push("--", extra);
  return parts.join(" ");
}

export function curlExitReason(exitCode) {
  const reasons = {
    6: "host not found",
    7: "connection refused",
    22: "http error",
    28: "timed out",
    35: "tls error",
    52: "empty reply",
    56: "connection reset",
  };
  return reasons[exitCode] || `curl exit ${exitCode}`;
}
