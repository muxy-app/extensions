// Turns a pasted curl command (from a terminal, docs, or a browser's
// "Copy as cURL") into a request.
import { normalizeRequest, suggestName } from "./store.js";

export function looksLikeCurl(text) {
  return /^\s*curl(\.exe)?\s+\S/i.test(String(text || ""));
}

const ANSI = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", v: "\v", "?": "?" };

export function shellSplit(s) {
  const out = [];
  let cur = "";
  let has = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && (s[i + 1] === "\n" || (s[i + 1] === "\r" && s[i + 2] === "\n"))) {
      i += s[i + 1] === "\r" ? 3 : 2;
      continue;
    }
    if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = "";
      has = false;
      i++;
      continue;
    }
    has = true;
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      cur += j < 0 ? s.slice(i + 1) : s.slice(i + 1, j);
      i = j < 0 ? s.length : j + 1;
      continue;
    }
    if (c === "$" && s[i + 1] === "'") {
      i += 2;
      while (i < s.length && s[i] !== "'") {
        if (s[i] === "\\" && i + 1 < s.length) {
          const n = s[i + 1];
          if (n in ANSI) {
            cur += ANSI[n];
            i += 2;
          } else if (n === "x" && /^[0-9a-f]{1,2}/i.test(s.slice(i + 2))) {
            const hex = s.slice(i + 2).match(/^[0-9a-f]{1,2}/i)[0];
            cur += String.fromCharCode(parseInt(hex, 16));
            i += 2 + hex.length;
          } else if ((n === "u" || n === "U") && /^[0-9a-f]{1,8}/i.test(s.slice(i + 2))) {
            const hex = s.slice(i + 2).match(n === "u" ? /^[0-9a-f]{1,4}/i : /^[0-9a-f]{1,8}/i)[0];
            cur += String.fromCodePoint(parseInt(hex, 16));
            i += 2 + hex.length;
          } else if (/[0-7]/.test(n)) {
            const oct = s.slice(i + 1).match(/^[0-7]{1,3}/)[0];
            cur += String.fromCharCode(parseInt(oct, 8));
            i += 1 + oct.length;
          } else {
            cur += "\\" + n;
            i += 2;
          }
        } else {
          cur += s[i++];
        }
      }
      i++;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length && '"\\$`\n'.includes(s[i + 1])) {
          if (s[i + 1] !== "\n") cur += s[i + 1];
          i += 2;
        } else {
          cur += s[i++];
        }
      }
      i++;
      continue;
    }
    if (c === "\\" && i + 1 < s.length) {
      cur += s[i + 1];
      i += 2;
      continue;
    }
    cur += c;
    i++;
  }
  if (has) out.push(cur);
  return out;
}

// Short options that take a value; the value may be attached (-XPOST).
const SHORT_VALUE = new Set("XHdFuAbeomxwcETrUKzDCPQY".split(""));
// Long options that take a value we ignore.
const LONG_VALUE = new Set([
  "--output", "--max-time", "--connect-timeout", "--proxy", "--write-out", "--retry", "--retry-delay", "--retry-max-time",
  "--cookie-jar", "--cert", "--key", "--cacert", "--capath", "--upload-file", "--resolve", "--limit-rate", "--range",
  "--proxy-user", "--config", "--interface", "--max-redirs", "--time-cond", "--unix-socket", "--aws-sigv4", "--dump-header",
  "--connect-to", "--continue-at", "--ciphers", "--cert-type", "--key-type", "--pass", "--trace", "--trace-ascii",
  "--stderr", "--max-filesize", "--speed-limit", "--speed-time", "--local-port", "--dns-servers", "--expect100-timeout",
  "--happy-eyeballs-timeout-ms", "--keepalive-time", "--tls-max", "--noproxy", "--preproxy", "--proxy-header", "--quote",
  "--request-target", "--sasl-authzid", "--service-name", "--socks5", "--socks5-hostname", "--variable", "--url-query",
]);

function parseQueryRows(qs) {
  return qs
    .split("&")
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf("=");
      const dec = (s) => {
        try {
          return decodeURIComponent(s.replace(/\+/g, " "));
        } catch {
          return s;
        }
      };
      return { key: dec(i < 0 ? part : part.slice(0, i)), value: i < 0 ? "" : dec(part.slice(i + 1)), enabled: true };
    });
}

function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function fromCurl(text) {
  const t = shellSplit(String(text || "").trim());
  if (!t.length || !/^curl(\.exe)?$/i.test(t[0])) return null;
  let method = null;
  let url = "";
  const headers = [];
  const data = [];
  const form = [];
  let user = null;
  let bearer = null;
  let get = false;
  let head = false;
  let json = false;
  let insecure = false;
  const queryExtra = [];

  const handle = (opt, takeValue) => {
    switch (opt) {
      case "-X":
      case "--request":
        method = takeValue().toUpperCase();
        return;
      case "-H":
      case "--header": {
        const h = takeValue();
        const i = h.indexOf(":");
        if (i > 0) headers.push({ key: h.slice(0, i).trim(), value: h.slice(i + 1).trim(), enabled: true });
        else if (h.trim().endsWith(";")) headers.push({ key: h.trim().slice(0, -1), value: "", enabled: true });
        return;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii":
        data.push(takeValue());
        return;
      case "--data-urlencode": {
        const v = takeValue();
        const i = v.indexOf("=");
        data.push(i > 0 ? `${v.slice(0, i)}=${encodeURIComponent(v.slice(i + 1))}` : encodeURIComponent(i === 0 ? v.slice(1) : v));
        return;
      }
      case "--json":
        data.push(takeValue());
        json = true;
        return;
      case "-F":
      case "--form":
      case "--form-string": {
        const v = takeValue();
        const i = v.indexOf("=");
        const key = i < 0 ? v : v.slice(0, i);
        let value = i < 0 ? "" : v.slice(i + 1);
        const isFile = opt !== "--form-string" && value.startsWith("@");
        if (isFile) value = value.slice(1).replace(/;type=[^;]*$/, "");
        form.push({ key, value, enabled: true, type: isFile ? "file" : "text" });
        return;
      }
      case "-u":
      case "--user":
        user = takeValue();
        return;
      case "--oauth2-bearer":
        bearer = takeValue();
        return;
      case "-A":
      case "--user-agent":
        headers.push({ key: "User-Agent", value: takeValue(), enabled: true });
        return;
      case "-b":
      case "--cookie": {
        const v = takeValue();
        if (v.includes("=")) headers.push({ key: "Cookie", value: v, enabled: true });
        return;
      }
      case "-e":
      case "--referer":
        headers.push({ key: "Referer", value: takeValue(), enabled: true });
        return;
      case "-G":
      case "--get":
        get = true;
        return;
      case "-I":
      case "--head":
        head = true;
        return;
      case "-k":
      case "--insecure":
        insecure = true;
        return;
      case "--url":
        url = takeValue();
        return;
      case "--url-query":
        queryExtra.push(takeValue());
        return;
      default:
        if (LONG_VALUE.has(opt) || (opt.length === 2 && SHORT_VALUE.has(opt[1]))) takeValue();
    }
  };

  for (let i = 1; i < t.length; i++) {
    const a = t[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const opt = eq > 2 ? a.slice(0, eq) : a;
      const inline = eq > 2 ? a.slice(eq + 1) : null;
      handle(opt, () => (inline != null ? inline : t[++i] ?? ""));
    } else if (/^-[a-zA-Z0-9]/.test(a)) {
      const chars = a.slice(1);
      for (let j = 0; j < chars.length; j++) {
        const opt = `-${chars[j]}`;
        if (SHORT_VALUE.has(chars[j])) {
          const rest = chars.slice(j + 1);
          handle(opt, () => (rest.length ? rest : t[++i] ?? ""));
          break;
        }
        handle(opt, () => "");
      }
    } else if (!url) {
      url = a;
    }
  }
  if (!url) return null;

  const ctHeader = headers.find((h) => h.key.toLowerCase() === "content-type");
  const ct = (ctHeader?.value || "").toLowerCase();
  const body = { mode: "none", text: "", form: [], multipart: [] };
  if (form.length) {
    body.mode = "multipart";
    body.multipart = form;
  } else if (data.length) {
    const joined = data.join("&");
    if (get) {
      queryExtra.push(joined);
    } else if (json || ct.includes("json") || (!ct && /^\s*[[{]/.test(joined) && prettyJson(joined) !== joined)) {
      body.mode = "json";
      body.text = prettyJson(joined);
      if (json && !ctHeader) headers.push({ key: "Content-Type", value: "application/json", enabled: true });
    } else if (ct.includes("xml")) {
      body.mode = "xml";
      body.text = joined;
    } else if (ct.includes("x-www-form-urlencoded") || (!ct && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(joined))) {
      body.mode = "form";
      body.form = parseQueryRows(joined);
    } else {
      body.mode = "text";
      body.text = joined;
    }
  }
  for (const q of queryExtra) url += (url.includes("?") ? "&" : "?") + q;

  let auth = { type: "none" };
  if (user != null) {
    const i = user.indexOf(":");
    auth = { type: "basic", username: i < 0 ? user : user.slice(0, i), password: i < 0 ? "" : user.slice(i + 1) };
  } else if (bearer != null) {
    auth = { type: "bearer", token: bearer };
  }

  const finalMethod = head ? "HEAD" : method || ((data.length && !get) || form.length ? "POST" : "GET");
  const req = normalizeRequest({
    method: finalMethod,
    url,
    headers,
    body,
    auth,
    settings: { followRedirects: true, timeoutSec: 30, insecure, compressed: true },
  });
  req.name = suggestName(req);
  return req;
}
