const CURL = "/usr/bin/curl";
const DEFAULT_TIMEOUT_SEC = 15;

export class HttpError extends Error {
  constructor(status, body, url) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

export class NetworkError extends Error {
  constructor(message, url) {
    super(`Network error for ${url}: ${message}`);
    this.url = url;
  }
}

export function muxyExec() {
  if (!window.muxy || typeof window.muxy.exec !== "function") {
    throw new Error("window.muxy.exec is unavailable — open this panel inside Muxy.");
  }
  return window.muxy.exec.bind(window.muxy);
}

function buildArgv({ method, url, headers, body, timeoutSec }) {
  const argv = [
    CURL,
    "--silent",
    "--show-error",
    "--location",
    "--max-time", String(timeoutSec),
    "--write-out", "\n%{http_code}",
    "-X", method,
  ];
  for (const [k, v] of Object.entries(headers || {})) {
    argv.push("-H", `${k}: ${v}`);
  }
  if (body != null) {
    argv.push("--data-binary", body);
  }
  argv.push(url);
  return argv;
}

function parseResponse(stdout) {
  const text = stdout || "";
  const split = text.lastIndexOf("\n");
  if (split < 0) {
    return { status: 0, body: text };
  }
  const status = Number(text.slice(split + 1).trim());
  const body = text.slice(0, split);
  return { status: Number.isFinite(status) ? status : 0, body };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function httpRequest({
  method = "GET",
  url,
  headers = {},
  body = null,
  timeoutSec = DEFAULT_TIMEOUT_SEC,
  accept = "application/json",
  retries = 0,
} = {}) {
  if (!url) throw new Error("httpRequest: url is required");
  const finalHeaders = { Accept: accept, ...headers };
  const argv = buildArgv({ method, url, headers: finalHeaders, body, timeoutSec });

  // A transient connection failure (no HTTP status — common on relay / *.plex.direct
  // links) is retried a few times before it surfaces, so a single blip never bubbles
  // up to the UI. A real HTTP response (incl. 4xx/5xx) is returned immediately.
  for (let attempt = 0; ; attempt++) {
    let result;
    try {
      result = await muxyExec()(argv, { timeoutMs: (timeoutSec + 2) * 1000 });
    } catch (err) {
      if (attempt < retries) {
        await delay(250 * (attempt + 1));
        continue;
      }
      throw new NetworkError(err?.message || String(err), url);
    }
    const { status, body: respBody } = parseResponse(result?.stdout);
    if (status === 0) {
      if (attempt < retries) {
        await delay(250 * (attempt + 1));
        continue;
      }
      const stderr = (result?.stderr || "").trim();
      throw new NetworkError(stderr || "no HTTP status returned", url);
    }
    if (status >= 400) {
      throw new HttpError(status, respBody, url);
    }
    return { status, body: respBody, headers: finalHeaders };
  }
}

export async function httpJSON(opts) {
  const res = await httpRequest(opts);
  if (!res.body) return null;
  try {
    return JSON.parse(res.body);
  } catch (err) {
    throw new Error(`Invalid JSON from ${opts.url}: ${err.message}`);
  }
}
