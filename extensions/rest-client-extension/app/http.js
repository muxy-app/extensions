// Sends a request with curl on the project's machine (muxy.exec), so
// localhost and private hosts work, and a remote project calls from where its
// code runs. curl always gets an argument list, never a shell, and the body
// goes through stdin. If curl is missing, Muxy's own http.fetch is the fallback.
import { mx, uid, utf8Length } from "./ui.js";
import { resolve } from "./vars.js";

export class SendError extends Error {
  constructor(message, kind = "error", hint = "") {
    super(message);
    this.kind = kind;
    this.hint = hint;
  }
}

const CONTENT_TYPES = { json: "application/json", text: "text/plain", xml: "application/xml" };

const REASONS = {
  100: "Continue", 101: "Switching Protocols", 200: "OK", 201: "Created", 202: "Accepted", 203: "Non-Authoritative Information",
  204: "No Content", 205: "Reset Content", 206: "Partial Content", 207: "Multi-Status", 301: "Moved Permanently", 302: "Found",
  303: "See Other", 304: "Not Modified", 307: "Temporary Redirect", 308: "Permanent Redirect", 400: "Bad Request",
  401: "Unauthorized", 402: "Payment Required", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed",
  406: "Not Acceptable", 407: "Proxy Authentication Required", 408: "Request Timeout", 409: "Conflict", 410: "Gone",
  411: "Length Required", 412: "Precondition Failed", 413: "Content Too Large", 414: "URI Too Long",
  415: "Unsupported Media Type", 416: "Range Not Satisfiable", 417: "Expectation Failed", 418: "I'm a teapot",
  421: "Misdirected Request", 422: "Unprocessable Content", 423: "Locked", 424: "Failed Dependency", 425: "Too Early",
  426: "Upgrade Required", 428: "Precondition Required", 429: "Too Many Requests", 431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons", 500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway",
  503: "Service Unavailable", 504: "Gateway Timeout", 505: "HTTP Version Not Supported", 507: "Insufficient Storage",
  508: "Loop Detected", 511: "Network Authentication Required",
};

export const reasonPhrase = (code) => REASONS[code] || "";

// Percent-encodes what curl won't accept in a URL, leaving existing %XX alone.
export function sanitizeUrl(url) {
  return String(url).replace(/[^\x21-\x7e]|["<>`{}|\\^]/gu, (c) => (c === " " ? "%20" : encodeURIComponent(c)));
}

function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function addQuery(url, key, value) {
  const hash = url.indexOf("#");
  const base = hash >= 0 ? url.slice(0, hash) : url;
  const frag = hash >= 0 ? url.slice(hash) : "";
  const pair = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  return base + (base.includes("?") ? (base.endsWith("?") || base.endsWith("&") ? "" : "&") : "?") + pair + frag;
}

const formEnc = (s) => encodeURIComponent(s).replace(/%20/g, "+");

// Resolves variables and auth into what is actually sent.
export function prepare(req, vars) {
  const r = (s) => resolve(String(s ?? ""), vars);
  const method = String(req.method || "GET").toUpperCase().trim() || "GET";
  let url = r(req.url).trim();
  if (!url) throw new SendError("Enter a URL to send the request.", "input");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
  if (!/^https?:\/\//i.test(url)) throw new SendError(`Only http:// and https:// URLs can be sent, not ${url.split(":")[0]}://.`, "input");

  const headers = [];
  for (const h of req.headers || []) {
    if (h.enabled === false) continue;
    const key = r(h.key).trim();
    if (key) headers.push([key, r(h.value)]);
  }
  const has = (name) => headers.some(([k]) => k.toLowerCase() === name.toLowerCase());

  const auth = req.auth || {};
  if (auth.type === "bearer" && String(auth.token).trim() && !has("authorization")) {
    const prefix = r(auth.prefix ?? "Bearer").trim();
    headers.push(["Authorization", `${prefix ? prefix + " " : ""}${r(auth.token).trim()}`]);
  } else if (auth.type === "basic" && (auth.username || auth.password) && !has("authorization")) {
    headers.push(["Authorization", `Basic ${b64(`${r(auth.username)}:${r(auth.password)}`)}`]);
  } else if (auth.type === "apikey" && String(auth.key).trim()) {
    const key = r(auth.key).trim();
    if (auth.in === "query") url = addQuery(url, key, r(auth.value));
    else if (!has(key)) headers.push([key, r(auth.value)]);
  }

  let body = null;
  let form = null;
  const b = req.body || {};
  if (b.mode === "json" || b.mode === "text" || b.mode === "xml") {
    const text = r(b.text);
    if (text.length) {
      body = text;
      if (!has("content-type")) headers.push(["Content-Type", CONTENT_TYPES[b.mode]]);
    }
  } else if (b.mode === "form") {
    const rows = (b.form || []).filter((x) => x.enabled !== false && String(x.key).trim());
    if (rows.length) {
      body = rows.map((x) => `${formEnc(r(x.key))}=${formEnc(r(x.value))}`).join("&");
      if (!has("content-type")) headers.push(["Content-Type", "application/x-www-form-urlencoded"]);
    }
  } else if (b.mode === "multipart") {
    const rows = (b.multipart || []).filter((x) => x.enabled !== false && String(x.key).trim());
    if (rows.length) form = rows.map((x) => ({ name: r(x.key), value: r(x.value), file: x.type === "file" }));
  }

  const s = req.settings || {};
  return {
    method,
    url: sanitizeUrl(url),
    headers,
    body,
    form,
    settings: {
      followRedirects: s.followRedirects !== false,
      timeoutSec: Number(s.timeoutSec) || 0,
      insecure: !!s.insecure,
      compressed: s.compressed !== false,
    },
  };
}

// curl picks POST by itself when there is a body, and then follows a 301/302/303
// with GET like a browser. -X would keep POST across redirects, so only pass it
// when curl wouldn't choose the method on its own.
function methodArgs(p) {
  const hasBody = p.body != null || !!p.form;
  if (p.method === "HEAD") return ["--head"];
  if (p.method === "GET" && !hasBody) return [];
  if (p.method === "POST" && hasBody) return [];
  return ["-X", p.method];
}

const WRITE_OUT = [
  "%{http_code}", "%{time_namelookup}", "%{time_connect}", "%{time_appconnect}", "%{time_pretransfer}",
  "%{time_starttransfer}", "%{time_total}", "%{size_download}", "%{size_header}", "%{size_upload}",
  "%{url_effective}", "%{remote_ip}", "%{remote_port}", "%{http_version}", "%{num_redirects}", "%{content_type}",
].join("\t");

export function curlArgs(p, mark) {
  const a = ["-sS", "--globoff", "-w", mark + WRITE_OUT];
  // --head prints the headers as output already
  if (p.method !== "HEAD") a.push("-D", "-");
  if (p.settings.compressed) a.push("--compressed");
  if (p.settings.followRedirects) a.push("-L", "--max-redirs", "20");
  if (p.settings.insecure) a.push("-k");
  if (p.settings.timeoutSec > 0) a.push("--max-time", String(p.settings.timeoutSec));
  a.push(...methodArgs(p));
  for (const [k, v] of p.headers) a.push("-H", v === "" ? `${k};` : `${k}: ${v}`);
  if (p.form) {
    for (const f of p.form) {
      if (f.file) a.push("-F", `${f.name}=@${f.value}`);
      else a.push("--form-string", `${f.name}=${f.value}`);
    }
  } else if (p.body != null) {
    a.push("--data-binary", "@-");
  }
  a.push("--url", p.url);
  return a;
}

const shq = (s) => (/^[A-Za-z0-9_\-+=.,/:@%]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`);

// A command to paste into a terminal: the same request, with variables resolved.
export function toCurlCommand(p) {
  const parts = ["curl"];
  const m = methodArgs(p);
  if (m.length) parts.push(m.map(shq).join(" "));
  parts.push(shq(p.url));
  if (/[[\]{}]/.test(p.url)) parts.push("--globoff");
  for (const [k, v] of p.headers) parts.push(`-H ${shq(v === "" ? `${k};` : `${k}: ${v}`)}`);
  if (p.form) {
    for (const f of p.form) parts.push(f.file ? `-F ${shq(`${f.name}=@${f.value}`)}` : `--form-string ${shq(`${f.name}=${f.value}`)}`);
  } else if (p.body != null) {
    parts.push(`--data-raw ${shq(p.body)}`);
  }
  if (p.settings.followRedirects) parts.push("-L");
  if (p.settings.insecure) parts.push("-k");
  if (p.settings.compressed) parts.push("--compressed");
  return parts.join(" \\\n  ");
}

// ---------------------------------------------------------------- send

const CURL_HINTS = {
  6: ["Couldn't resolve the host", "Check the URL, or the variable that sets the host."],
  7: ["Couldn't connect", "Nothing answered at that address. Is the server running?"],
  28: ["The request timed out", "Raise the timeout in the Settings tab, or set it to 0 for none."],
  35: ["TLS handshake failed", ""],
  47: ["Too many redirects", ""],
  51: ["The server's certificate doesn't match its name", "Turn on “Skip TLS verification” in Settings to send anyway."],
  52: ["The server sent an empty reply", ""],
  56: ["The connection was reset", ""],
  58: ["Problem with the client certificate", ""],
  60: ["The server's certificate isn't trusted", "Turn on “Skip TLS verification” in Settings to send anyway."],
  26: ["Couldn't read a file to upload", "File paths in multipart forms are relative to the project folder."],
};

function curlError(res) {
  const lines = String(res.stderr || "").trim().split("\n").filter(Boolean);
  const last = lines.reverse().find((l) => /^curl: \(\d+\)/.test(l)) || lines[0] || "";
  const detail = last.replace(/^curl: \(\d+\)\s*/, "").trim();
  const [title, hint] = CURL_HINTS[res.exitCode] || [];
  if (res.timedOut) return new SendError("The request timed out", "timeout", CURL_HINTS[28][1]);
  if (title) return new SendError(detail ? `${title}: ${detail}` : title, `curl-${res.exitCode}`, hint);
  return new SendError(detail || `curl stopped with exit code ${res.exitCode}`, `curl-${res.exitCode}`);
}

function parseHeaderBlock(block) {
  const lines = block.split(/\r?\n/);
  const status = lines.shift() || "";
  const m = status.match(/^HTTP\/(\S+)\s+(\d{3})\s*(.*)$/);
  const headers = [];
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i > 0) headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return { version: m ? m[1] : "", status: m ? Number(m[2]) : 0, reason: m ? m[3].trim() : "", headers };
}

export function parseCurlOutput(res, mark, elapsed) {
  const out = String(res.stdout || "");
  const at = out.lastIndexOf(mark);
  if (at < 0) throw curlError(res);
  const f = out.slice(at + mark.length).split("\t");
  const code = parseInt(f[0], 10) || 0;
  if (!code) throw curlError(res);
  const sec = (i) => Math.max(0, Number(f[i]) || 0) * 1000;
  const headerBytes = Number(f[8]) || 0;

  let rest = out.slice(0, at);
  const blocks = [];
  let consumed = 0;
  while (/^HTTP\/\S+\s+\d{3}/.test(rest) && (consumed < headerBytes || !blocks.length)) {
    let end = rest.indexOf("\r\n\r\n");
    let sep = 4;
    if (end < 0) {
      end = rest.indexOf("\n\n");
      sep = 2;
    }
    if (end < 0) {
      blocks.push(rest);
      consumed += rest.length;
      rest = "";
      break;
    }
    blocks.push(rest.slice(0, end));
    consumed += end + sep;
    rest = rest.slice(end + sep);
  }
  const finalBlock = blocks.length ? parseHeaderBlock(blocks[blocks.length - 1]) : { version: "", status: code, reason: "", headers: [] };
  const body = rest;
  const t = { dns: sec(1), connect: sec(2), tls: sec(3), pretransfer: sec(4), ttfb: sec(5), total: sec(6) };

  return {
    engine: "curl",
    at: Date.now(),
    status: code,
    statusText: finalBlock.reason || reasonPhrase(code),
    httpVersion: f[13] || finalBlock.version,
    headers: finalBlock.headers,
    redirectChain: blocks.slice(0, -1).map((b) => {
      const p = parseHeaderBlock(b);
      return { status: p.status, location: p.headers.find(([k]) => k.toLowerCase() === "location")?.[1] || "" };
    }),
    body,
    bodyBytes: utf8Length(body),
    transferBytes: Number(f[7]) || 0,
    headerBytes,
    uploadBytes: Number(f[9]) || 0,
    url: f[10] || "",
    remoteIp: f[11] || "",
    remotePort: f[12] || "",
    redirects: Number(f[14]) || 0,
    contentType: f[15] || finalBlock.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] || "",
    timing: {
      dns: t.dns,
      tcp: Math.max(0, t.connect - t.dns),
      tls: t.tls ? Math.max(0, t.tls - t.connect) : 0,
      wait: Math.max(0, t.ttfb - t.pretransfer),
      download: Math.max(0, t.total - t.ttfb),
      total: t.total || elapsed,
    },
    truncated: !!res.truncated,
    warning: res.exitCode ? curlError(res).message : "",
  };
}

function looksMissing(err, res) {
  if (res && res.exitCode === 127) return true;
  const msg = String(err?.message || err || "");
  return /no such file|not found|ENOENT|executable/i.test(msg) && /curl/i.test(msg);
}

function looksDenied(err) {
  return /denied|not allowed|cancel|blocked|permission/i.test(String(err?.message || err || ""));
}

async function viaFetch(p, started) {
  const m = mx();
  if (typeof m.http?.fetch !== "function") throw new SendError("curl isn't installed on this machine.", "engine");
  if (p.form) throw new SendError("Multipart forms need curl, which isn't installed on this machine.", "engine");
  const headers = {};
  for (const [k, v] of p.headers) headers[k] = v;
  const timeoutMs = Math.min(120000, (p.settings.timeoutSec || 120) * 1000);
  const res = await m.http.fetch(p.url, { method: p.method, headers, body: p.body ?? undefined, timeoutMs });
  const elapsed = performance.now() - started;
  const list = Array.isArray(res.headers) ? res.headers : Object.entries(res.headers || {});
  const body = typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? "");
  return {
    engine: "muxy",
    at: Date.now(),
    status: res.status,
    statusText: reasonPhrase(res.status),
    httpVersion: "",
    headers: list.map(([k, v]) => [String(k), String(v)]),
    redirectChain: [],
    body,
    bodyBytes: utf8Length(body),
    transferBytes: utf8Length(body),
    headerBytes: 0,
    uploadBytes: p.body ? utf8Length(p.body) : 0,
    url: p.url,
    remoteIp: "",
    remotePort: "",
    redirects: 0,
    contentType: list.find(([k]) => String(k).toLowerCase() === "content-type")?.[1] || "",
    timing: { total: elapsed },
    truncated: !!res.truncated,
    warning: "Sent with Muxy's web requests because curl isn't installed. Localhost and private networks can't be reached this way.",
  };
}

// Returns { promise, cancel }. The promise resolves to a response, or rejects
// with a SendError.
export function send(p) {
  const m = mx();
  let handle = null;
  let cancelled = false;
  const mark = `\n__MUXY_REST_${uid()}__`;
  const args = ["curl", ...curlArgs(p, mark)];
  const opts = { timeoutMs: Math.min(300000, ((p.settings.timeoutSec || 290) + 10) * 1000) };
  if (p.body != null && !p.form) opts.stdin = p.body;

  const promise = (async () => {
    const started = performance.now();
    let res;
    try {
      if (typeof m.execAsync === "function") {
        handle = await m.execAsync(args, opts);
        if (cancelled) handle.cancel?.();
        res = await handle.result;
      } else {
        res = await m.exec(args, opts);
      }
    } catch (e) {
      if (cancelled) throw new SendError("Request cancelled", "cancelled");
      if (looksMissing(e)) return viaFetch(p, started);
      if (looksDenied(e)) throw new SendError("Muxy didn't allow running curl", "denied", "Send again and choose Allow & Remember, so requests can go out through curl.");
      throw new SendError(e?.message || String(e), "exec");
    }
    if (cancelled) throw new SendError("Request cancelled", "cancelled");
    if (looksMissing(null, res)) return viaFetch(p, started);
    return parseCurlOutput(res, mark, performance.now() - started);
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      try {
        handle?.cancel?.();
      } catch {}
    },
  };
}
