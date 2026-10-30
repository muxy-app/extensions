// A small MIME parser: enough to pull the text/plain and text/html bodies out
// of a raw RFC 5322 message (what `himalaya message read --raw` returns).
//
// It handles the common cases — single part, multipart/alternative,
// multipart/mixed and multipart/related (recursively) — with base64 and
// quoted-printable decoding and charset-aware text decoding. It is not a full
// RFC implementation; anything it cannot parse simply yields no body.

function splitHeadersBody(str) {
  const i1 = str.indexOf("\r\n\r\n");
  const i2 = str.indexOf("\n\n");
  let idx = -1;
  let skip = 0;
  if (i1 !== -1 && (i2 === -1 || i1 <= i2)) {
    idx = i1;
    skip = 4;
  } else if (i2 !== -1) {
    idx = i2;
    skip = 2;
  }
  if (idx === -1) return { head: str, body: "" };
  return { head: str.slice(0, idx), body: str.slice(idx + skip) };
}

function parseHeaders(head) {
  // Unfold continuation lines (RFC 5322 folding), then split on the first colon.
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  const headers = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const c = line.indexOf(":");
    if (c === -1) continue;
    const key = line.slice(0, c).trim().toLowerCase();
    const value = line.slice(c + 1).trim();
    if (!(key in headers)) headers[key] = value;
  }
  return headers;
}

function parseContentType(value) {
  const raw = value || "text/plain";
  const mime = raw.split(";")[0].trim().toLowerCase();
  const params = {};
  const re = /(\w[\w-]*)=("[^"]*"|[^;]+)/g;
  let m;
  while ((m = re.exec(raw))) {
    params[m[1].toLowerCase()] = m[2].replace(/^"|"$/g, "").trim();
  }
  return { mime, params };
}

function b64ToBytes(b64) {
  try {
    const bin = atob(b64.replace(/[^A-Za-z0-9+/=]/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

function qpToBytes(str) {
  const out = [];
  const s = str.replace(/=\r?\n/g, ""); // soft line breaks
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && i + 2 < s.length) {
      const hex = s.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    out.push(s.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

function decodeText(body, cte, charset) {
  const enc = (cte || "").toLowerCase();
  const cs = (charset || "utf-8").toLowerCase();
  if (enc === "base64" || enc === "quoted-printable") {
    const bytes = enc === "base64" ? b64ToBytes(body) : qpToBytes(body);
    try {
      return new TextDecoder(cs).decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
  // 7bit / 8bit / binary: himalaya already handed us a decoded string.
  return body;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Recursively collect the first text/plain and text/html leaves.
function walk(part, out) {
  const { head, body } = splitHeadersBody(part);
  const headers = parseHeaders(head);
  const { mime, params } = parseContentType(headers["content-type"]);
  const cte = headers["content-transfer-encoding"];

  if (mime.startsWith("multipart/") && params.boundary) {
    const marker = "--" + params.boundary;
    const chunks = body.split(new RegExp(escapeRe(marker) + "(?:--)?\\r?\\n?"));
    for (const chunk of chunks) {
      const trimmed = chunk.replace(/^\r?\n/, "");
      if (!trimmed.trim()) continue;
      walk(trimmed, out);
    }
    return;
  }

  if (mime === "text/html" && out.html == null) {
    out.html = decodeText(body, cte, params.charset);
  } else if (mime === "text/plain" && out.text == null) {
    out.text = decodeText(body, cte, params.charset);
  }
}

// Parse a raw RFC 5322 message into { text, html } (either may be null).
export function parseMessage(raw) {
  const out = { text: null, html: null };
  try {
    walk(raw, out);
  } catch {
    /* leave whatever was collected */
  }
  return out;
}
