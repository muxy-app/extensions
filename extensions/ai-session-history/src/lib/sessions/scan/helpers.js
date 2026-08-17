/** Shared pure helpers for session scanners (no host I/O). */

import { oneLine } from "../../sanitize.js";
import { chain } from "../../host-fs.js";

export const PER_GROUP_CAP = 25;

/** Extra candidates to enrich so dir-mtime skew does not drop fresh sessions. */
export const ENRICH_SLACK = 10;

/** mapPool concurrency for host-fs bound scanners (lower = friendlier on remote). */
export const SCAN_CONCURRENCY = 8;

/** Codex JSONL fallback: max directories to walk. */
export const CODEX_MAX_DIRS_WALKED = 200;

/**
 * Copilot: max residual session-state dirs to FS-probe when not already
 * DB-indexed for the active cwd (mtime-ordered). Full `listDirDetailed` is
 * always cheap; this only caps expensive per-dir yaml/events reads.
 */
export const COPILOT_MAX_STATE_DIRS = 100;

export const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const CODEX_ROLLOUT_RE =
  /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-fA-F-]{36})\.jsonl(?:\.zst)?$/;

/**
 * Filter + sort directory entries by mtime descending, then take a limit.
 * @param {Array<{ name: string, kind?: string, mtimeMs?: number }>} entries
 * @param {{
 *   limit?: number,
 *   kind?: 'file'|'dir'|null,
 *   nameOk?: (name: string) => boolean,
 * }} [opts]
 */
export function takeRecent(entries, opts = {}) {
  const limit = opts.limit ?? PER_GROUP_CAP;
  const kind = opts.kind ?? null;
  const nameOk = opts.nameOk ?? (() => true);
  return (entries || [])
    .filter((e) => {
      if (!e || !nameOk(e.name)) return false;
      if (kind && e.kind !== kind) return false;
      return true;
    })
    .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
    .slice(0, Math.max(0, limit));
}

const WEAK_TITLES = new Set(["", "(untitled)", "untitled", "session"]);


/** Title-like column preference for Copilot (and similar) session stores. */
export const TITLE_LIKE_COLUMNS = ["title", "summary", "name"];

/**
 * Resolve which title-like column exists on a sessions-like table.
 * Order matches scan enrichment: title → summary → name.
 * @param {Set<string> | Iterable<string>} cols
 * @returns {string | null}
 */
export function resolveTitleLikeColumn(cols) {
  const set = cols instanceof Set ? cols : new Set(cols);
  return TITLE_LIKE_COLUMNS.find((c) => set.has(c)) || null;
}


/**
 * UTF-8 encode without TextEncoder (unavailable in Muxy runScript / JSC).
 * @param {string} str
 * @returns {Uint8Array}
 */
export function utf8Bytes(str) {
  const s = String(str);
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let code = s.charCodeAt(i);
    // Surrogate pair → full code point
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code <= 0x7f) {
      out.push(code);
    } else if (code <= 0x7ff) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      out.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

/**
 * Match Python urllib.parse.quote(s, safe="") for path segments.
 * Unquoted: A-Za-z0-9_.-
 * @param {string} str
 */
export function pathQuote(str) {
  let out = "";
  const bytes = utf8Bytes(String(str));
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    const ch = String.fromCharCode(b);
    if (/[A-Za-z0-9_.-]/.test(ch)) {
      out += ch;
    } else {
      out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/**
 * Pure JS MD5 (hex) for Cursor chat root hashing.
 * @param {string} text
 */
export function md5Hex(text) {
  // Minimal MD5 implementation (RFC 1321) — UTF-8 bytes (no TextEncoder).
  return md5Bytes(utf8Bytes(String(text)));
}

function md5Bytes(bytes) {
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
    21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  let total = withOne + 8;
  const pad = (64 - (total % 64)) % 64;
  total += pad;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  // little-endian length in bits (low 32 only is enough for our paths)
  view.setUint32(total - 8, bitLen >>> 0, true);
  view.setUint32(total - 4, Math.floor(bitLen / 0x100000000), true);

  const rotl = (x, n) => (x << n) | (x >>> (32 - n));

  for (let offset = 0; offset < total; offset += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      M[i] = view.getUint32(offset + i * 4, true);
    }
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F;
      let g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true);
  ov.setUint32(4, b0, true);
  ov.setUint32(8, c0, true);
  ov.setUint32(12, d0, true);
  let hex = "";
  for (const b of out) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * @param {any} value
 * @returns {number | null}
 */
export function isoToMs(value) {
  if (typeof value === "boolean") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.trunc(value);
    return Math.abs(n) < 1_000_000_000_000 ? n * 1000 : n;
  }
  if (typeof value !== "string" || !value) return null;
  try {
    const normalized = value.includes("T") ? value.replace("Z", "+00:00") : value;
    const parsed = Date.parse(normalized);
    if (Number.isNaN(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {string} cli
 * @param {string} sid
 * @param {string} title
 * @param {number} updated
 * @param {string | null} [branch]
 * @param {string | null} [cwd]
 */
export function sessionRow(cli, sid, title, updated, branch = null, cwd = null) {
  return {
    id: sid,
    title: oneLine(title) || "(untitled)",
    updatedAt: Math.trunc(updated || 0),
    branch: typeof branch === "string" && branch ? branch : null,
    cwd: typeof cwd === "string" && cwd ? cwd : null,
    cli,
  };
}

export function slugify(cwd) {
  return String(cwd)
    .split("")
    .map((ch) => (/[A-Za-z0-9]/.test(ch) ? ch : "-"))
    .join("");
}

export function pathMatchesCwd(pathVal, cwd) {
  if (!pathVal || typeof pathVal !== "string" || !cwd) return false;
  try {
    // Exact normalized path only — avoid substring false positives
    // (e.g. /tmp/proj matching /tmp/proj-old).
    return normPath(pathVal) === normPath(cwd);
  } catch {
    return false;
  }
}

export function normPath(p) {
  if (!p || typeof p !== "string") return "";
  // Collapse // and strip trailing slashes (except root).
  let s = p.replace(/\/+/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

export function isWeakTitle(value, sid) {
  if (value == null) return true;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (text === sid) return true;
  if (WEAK_TITLES.has(text.toLowerCase())) return true;
  if (UUID_RE.test(text)) return true;
  if (/^[0-9a-fA-F]{16,}$/.test(text)) return true;
  return false;
}

export function shortId(sid) {
  if (sid.length > 12) return `${sid.slice(0, 8)}…${sid.slice(-4)}`;
  return sid;
}

export function cwdBasename(path) {
  if (!path || typeof path !== "string") return null;
  const norm = path.replace(/[/\\]+$/, "");
  const parts = norm.split(/[/\\]/);
  return parts[parts.length - 1] || null;
}

/**
 * Best-effort flat key: value parser (workspace.yaml).
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseSimpleYaml(text) {
  const out = {};
  for (const line of String(text).split("\n")) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#") || !raw.includes(":")) continue;
    const idx = raw.indexOf(":");
    const key = raw.slice(0, idx).trim();
    let val = raw.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

/**
 * @param {*} value
 * @param {string} sid
 * @param {{ db_title?: any, yaml_name?: any, meta_title?: any, first_user?: any, cwd?: string | null, branch?: string | null }} meta
 */
export function pickDisplayTitle(sid, meta = {}) {
  const candidates = [meta.db_title, meta.yaml_name, meta.meta_title, meta.first_user];
  for (const cand of candidates) {
    if (!isWeakTitle(cand, sid)) {
      return oneLine(cand) || `Copilot · ${shortId(sid)}`;
    }
  }
  const base = cwdBasename(meta.cwd);
  if (base && meta.branch) return oneLine(`${base} · ${meta.branch}`);
  if (base) return oneLine(base);
  if (meta.branch) return oneLine(meta.branch);
  return `Copilot · ${shortId(sid)}`;
}

/**
 * Extract first user message text from events JSONL head.
 * @param {string} text
 * @param {number} [limit]
 */
export function firstUserMessageFromEvents(text, limit = 120) {
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length && i <= 400; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== "object") continue;
    const role = String(rec.role || rec.type || "").toLowerCase();
    if (!["user", "user.message", "human"].includes(role)) {
      const t = String(rec.type || "").toLowerCase();
      if (!t.includes("user") || t.includes("assistant")) continue;
    }
    let content =
      rec.content ?? rec.text ?? rec.message ?? rec.user_content ?? rec.data?.content;
    if (Array.isArray(content)) {
      const parts = [];
      for (const part of content) {
        if (typeof part === "string") parts.push(part);
        else if (part && typeof part === "object") {
          parts.push(String(part.text || part.content || ""));
        }
      }
      content = parts.join(" ");
    }
    if (content && typeof content === "object") {
      content = content.text || content.content;
    }
    if (typeof content === "string" && content.trim()) {
      return oneLine(content, limit);
    }
  }
  return null;
}

/**
 * Claude title chain from JSONL head text.
 * @param {string} text
 * @returns {{ title: string, cwd: string | null, branch: string | null }}
 */
export function claudeTitleFromJsonl(text) {
  let title = null;
  let cwd = null;
  let branch = null;
  let firstUser = null;
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length && i <= 200; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== "object") continue;
    if (typeof rec.cwd === "string" && !cwd) cwd = rec.cwd;
    if (typeof rec.gitBranch === "string" && !branch) branch = rec.gitBranch;
    const t = rec.type;
    if (t === "custom-title" && typeof (rec.title || rec.customTitle) === "string") {
      title = rec.title || rec.customTitle;
    } else if (t === "ai-title" && typeof (rec.title || rec.aiTitle) === "string") {
      title = title || rec.title || rec.aiTitle;
    } else if (t === "summary" && typeof rec.summary === "string") {
      title = title || rec.summary;
    } else if (t === "user" && firstUser == null) {
      const msg = rec.message;
      let content = msg && typeof msg === "object" ? msg.content : rec.content;
      if (typeof content === "string") {
        firstUser = content;
      } else if (Array.isArray(content)) {
        const parts = [];
        for (const block of content) {
          if (block && typeof block === "object" && typeof block.text === "string") {
            parts.push(block.text);
          } else if (typeof block === "string") {
            parts.push(block);
          }
        }
        if (parts.length) firstUser = parts.join("\n");
      }
    }
  }
  return { title: title || firstUser || "(untitled)", cwd, branch };
}

/**
 * Map over items with concurrency limit (async-only path).
 * Prefer mapSeq when host-fs may be sync (runScript) so chain stays plain values.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => R | Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) || 0 }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Sequential map that preserves host-fs chain duality (plain value or Promise).
 * Use this in scanners so runScript (sync muxy.exec) never needs async/await.
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => R | Promise<R>} fn
 * @returns {R[] | Promise<R[]>}
 */
export function mapSeq(items, fn) {
  const list = items || [];
  return list.reduce(
    (acc, item, index) =>
      chain(acc, (results) =>
        chain(fn(item, index), (value) => {
          results.push(value);
          return results;
        }),
      ),
    /** @type {R[]} */ ([]),
  );
}

/**
 * Run fn(); on throw or rejected thenable return fallback.
 * @template T
 * @param {() => T | Promise<T>} fn
 * @param {T} fallback
 * @returns {T | Promise<T>}
 */
export function tryChain(fn, fallback) {
  try {
    const v = fn();
    if (v != null && typeof v.then === "function") {
      return v.then(
        (x) => x,
        () => fallback,
      );
    }
    return v;
  } catch {
    return fallback;
  }
}

/**
 * Resolve thenable or value to a Promise.
 * @param {*} value
 */
export function toPromise(value) {
  if (value != null && typeof value.then === "function") return value;
  return Promise.resolve(value);
}
