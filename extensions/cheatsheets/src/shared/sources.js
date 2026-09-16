// Source layer for webview pages (viewer, popover): tlrc via exec, man via
// exec, and the HTTP fallback to tldr-pages on GitHub. All muxy.* calls here
// are the async page bridge — background.js does its own (sync) exec and only
// shares the pure parsers.
import {
  parseTldrPage, parseTldrList, parseTldrSearch, parseApropos, parseManList,
  parseManGrep, stripOverstrike,
} from "@/shared/parse";
import { sanitizeHtml } from "@/shared/sanitize";
import { validName, validSection } from "@/shared/refs";

// Settings are page-only by necessity: the background host exposes no
// muxy.storage (see background.js), so anything stored here is read and
// applied by the webview pages themselves.
export const DEFAULT_CONFIG = {
  version: 1,
  sourceOrder: ["tldr", "man"],
  platform: "osx",
  extraPlatforms: false,
  lang: "en",
  // Whether the "Search contents" checkbox starts ticked.
  contentSearchDefault: false,
};

export const INDEX_URL =
  "https://github.com/tldr-pages/tldr/releases/latest/download/index.json";
const INDEX_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const PAGE_CACHE_MAX = 50;

// Stable shell string → a single shell-exact consent. Never rebuilt dynamically.
export const MANLIST_V1 =
  "manpath | tr ':' '\\n' | while read -r d; do ls \"$d\"/man*/ 2>/dev/null; done";

export class SourceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'no-cache' | 'not-found' | 'unavailable' | 'bad-name'
  }
}

// --- config / storage ------------------------------------------------------

export async function loadConfig() {
  const stored = await muxy.storage.get("config");
  return { ...DEFAULT_CONFIG, ...(stored ?? {}) };
}

export async function saveConfig(config) {
  await muxy.storage.set("config", config);
}


export async function getRecents() {
  return (await muxy.storage.get("recents")) ?? [];
}

export async function getFavorites() {
  return (await muxy.storage.get("favorites")) ?? [];
}

export async function toggleFavorite(ref) {
  const favs = await getFavorites();
  const i = favs.findIndex((f) =>
    f.source === ref.source && f.name === ref.name && (f.section ?? "") === (ref.section ?? ""));
  if (i >= 0) favs.splice(i, 1);
  else favs.unshift({ source: ref.source, name: ref.name, section: ref.section });
  await muxy.storage.set("favorites", favs);
  return i < 0;
}

export async function isFavorite(ref) {
  const favs = await getFavorites();
  return favs.some((f) =>
    f.source === ref.source && f.name === ref.name && (f.section ?? "") === (ref.section ?? ""));
}

export async function pushRecent(ref) {
  const recents = await getRecents();
  const next = [{ source: ref.source, name: ref.name, section: ref.section }];
  for (const r of recents) {
    if (r.source === ref.source && r.name === ref.name &&
        (r.section ?? "") === (ref.section ?? "")) continue;
    next.push(r);
    if (next.length >= 20) break;
  }
  await muxy.storage.set("recents", next);
}

// --- fetch: one ref → one rendered-ready doc --------------------------------

// Returns { kind: 'tldr', page } | { kind: 'man-html', html } |
//         { kind: 'man-pre', runs }, plus { via: 'tlrc'|'man'|'http' }.
export async function fetchDoc(ref, config) {
  if (!validName(ref.name)) throw new SourceError("bad-name", "Invalid page name.");
  if (ref.source === "man") return fetchMan(ref);
  return fetchTldr(ref, config);
}

async function fetchTldr(ref, config) {
  let execFailure = null;
  try {
    return await fetchTlrc(ref, config);
  } catch (err) {
    if (err instanceof SourceError && err.code === "no-cache") throw err;
    execFailure = err;
  }
  try {
    return await fetchTldrHttp(ref, config);
  } catch (httpErr) {
    // Prefer the more specific exec-side error message when both fail.
    if (execFailure instanceof SourceError && execFailure.code === "not-found") throw execFailure;
    throw httpErr;
  }
}

async function fetchTlrc(ref, config) {
  const args = ["tldr", "--raw", "--quiet", "--color", "never", "--offline"];
  const platform = ref.platform ?? config.platform;
  if (platform && platform !== "auto") args.push("-p", platform);
  const lang = ref.lang ?? config.lang;
  if (lang && lang !== "en") args.push("-L", lang);
  args.push("--", ref.name);

  let result;
  try {
    result = await muxy.exec(args);
  } catch (err) {
    throw new SourceError("unavailable", `tldr could not run: ${err?.message ?? err}`);
  }
  if (result.exitCode === 0 && result.stdout.trim()) {
    return { kind: "tldr", page: parseTldrPage(result.stdout), via: "tlrc" };
  }
  const errText = `${result.stderr}\n${result.stdout}`;
  if (/cache does not exist/i.test(errText)) {
    throw new SourceError("no-cache",
      "The tldr cache has not been initialized yet. Run an update to download pages.");
  }
  if (/page not found/i.test(errText)) {
    throw new SourceError("not-found", `No tldr page for “${ref.name}”.`);
  }
  throw new SourceError("unavailable", firstLine(errText) || "tldr failed.");
}

export async function updateTldrCache() {
  const result = await muxy.exec(["tldr", "--update", "--quiet"], { timeoutMs: 120000 });
  if (result.exitCode !== 0) {
    throw new SourceError("unavailable",
      firstLine(result.stderr) || "tldr --update failed.");
  }
}

export async function tldrCacheInfo() {
  try {
    const result = await muxy.exec(["tldr", "-i", "--offline", "--quiet"]);
    return result.exitCode === 0 ? firstLine(result.stdout) : null;
  } catch {
    return null;
  }
}

// --- man ---------------------------------------------------------------------

async function fetchMan(ref) {
  if (ref.section && !validSection(ref.section)) {
    throw new SourceError("bad-name", "Invalid man section.");
  }
  const whereArgs = ref.section
    ? ["man", "-w", ref.section, "--", ref.name]
    : ["man", "-w", "--", ref.name];

  let where;
  try {
    where = await muxy.exec(whereArgs);
  } catch (err) {
    throw new SourceError("unavailable", `man could not run: ${err?.message ?? err}`);
  }
  const path = firstLine(where.stdout);
  if (where.exitCode !== 0 || !path) {
    throw new SourceError("not-found",
      `No man page for “${ref.name}${ref.section ? `(${ref.section})` : ""}”.`);
  }

  // Best path: mandoc HTML fragment (ships with macOS; handles gzip ≥ 1.14).
  try {
    const mandoc = await muxy.exec(["mandoc", "-T", "html", "-O", "fragment", path]);
    if (mandoc.exitCode === 0 && mandoc.stdout.trim() && !mandoc.truncated) {
      return { kind: "man-html", html: sanitizeHtml(mandoc.stdout), via: "man", path };
    }
  } catch {
    // mandoc missing → plaintext fallback
  }

  const catArgs = ref.section
    ? ["man", "-P", "cat", ref.section, "--", ref.name]
    : ["man", "-P", "cat", "--", ref.name];
  const result = await muxy.exec(catArgs);
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new SourceError("unavailable", firstLine(result.stderr) || "man failed.");
  }
  return { kind: "man-pre", runs: stripOverstrike(result.stdout), via: "man", path };
}

// --- listings (used by the popover; background.js has its own sync copies) ---

export async function listTldrRows(config) {
  try {
    const args = config.extraPlatforms
      ? ["tldr", "--list-all", "--quiet", "--offline"]
      : ["tldr", "--list", "--quiet", "--offline"];
    const result = await muxy.exec(args);
    if (result.exitCode === 0 && result.stdout.trim() &&
        !/cache does not exist/i.test(result.stdout + result.stderr)) {
      return parseTldrList(result.stdout).map((name) => ({ source: "tldr", name }));
    }
  } catch {
    // fall through to the HTTP index
  }
  const index = await getTldrIndex(config);
  if (!index) return [];
  const wanted = config.extraPlatforms
    ? null
    : new Set([config.platform, "common"]);
  return index.entries
    .filter(([, platforms]) => !wanted || platforms.some((p) => wanted.has(p)))
    .map(([name]) => ({ source: "tldr", name }));
}

export async function listManRows() {
  try {
    const result = await muxy.exec(["apropos", "."], { timeoutMs: 20000 });
    if (result.exitCode === 0 && result.stdout.trim()) {
      const rows = parseApropos(result.stdout);
      if (rows.length) return rows.map((r) => ({ source: "man", ...r }));
    }
  } catch {
    // fall through
  }
  try {
    const result = await muxy.exec({ shell: MANLIST_V1, timeoutMs: 20000 });
    if (result.exitCode === 0) {
      return parseManList(result.stdout).map((r) => ({ source: "man", ...r }));
    }
  } catch {
    // no man listing available
  }
  return [];
}

// --- content search ("Search contents") --------------------------------------

// Below this, a grep over the whole man tree matches nearly everything and
// costs a second for the privilege.
export const CONTENT_MIN = 3;

// -F so the term is a literal, not a regex ('c++' would otherwise fail to
// compile); -I so binaries never land in the results; -- so a term starting
// with '-' is not read as a flag. Consent is argvPrefix-keyed on the command
// name, so the term can vary freely without re-prompting.
const GREP_FLAGS = ["-r", "-l", "-i", "-I", "-F", "--"];
const GREP_TIMEOUT = 30000;

// Searches inside page text on both sources at once. Each half reports its own
// failure via `notes` rather than throwing, so one missing CLI never hides the
// other's results.
export async function searchContents(term) {
  const [tldr, man] = await Promise.all([
    searchTldrContents(term),
    searchManContents(term),
  ]);
  return {
    rows: [...tldr.rows, ...man.rows],
    notes: [tldr.note, man.note].filter(Boolean),
  };
}

async function searchTldrContents(term) {
  let result;
  try {
    result = await muxy.exec(["tldr", "--search", term, "--quiet", "--offline"],
      { timeoutMs: 15000 });
  } catch {
    return { rows: [], note: "tldr not searched — the tldr CLI is not installed (brew install tlrc)." };
  }
  if (result.timedOut) return { rows: [], note: "tldr search timed out." };
  if (result.exitCode !== 0) {
    const errText = `${result.stderr}\n${result.stdout}`;
    if (/cache does not exist/i.test(errText)) {
      return { rows: [], note: "tldr not searched — the page cache is empty; run a cache update." };
    }
    return { rows: [], note: null }; // no hits
  }
  return {
    rows: parseTldrSearch(result.stdout).map((hit) => ({
      source: "tldr",
      name: hit.name,
      platform: hit.platform,
      desc: `${hit.lang} · ${hit.platform}`,
    })),
    note: null,
  };
}

async function searchManContents(term) {
  let dirs = [];
  try {
    const mp = await muxy.exec(["manpath"], { timeoutMs: 10000 });
    if (mp.exitCode === 0) {
      dirs = mp.stdout.trim().split(":").map((d) => d.trim()).filter(Boolean);
    }
  } catch {
    // manpath missing → no roots to search
  }
  if (!dirs.length) {
    return { rows: [], note: "man not searched — could not read the manpath." };
  }

  // zgrep first: it reads gzipped pages (most Linux remotes) and plain ones
  // (macOS) at the same speed. Plain grep is the fallback where it is missing,
  // and silently skips compressed pages.
  for (const cmd of ["zgrep", "grep"]) {
    let result;
    try {
      result = await muxy.exec([cmd, ...GREP_FLAGS, term, ...dirs],
        { timeoutMs: GREP_TIMEOUT });
    } catch {
      continue; // command not available → try the next one
    }
    if (result.timedOut) {
      return { rows: [], note: "man search timed out — try a longer term." };
    }
    if (result.exitCode === 1) return { rows: [], note: null }; // grep: no matches
    if (result.exitCode !== 0) continue;                        // grep: real error
    return {
      rows: parseManGrep(result.stdout).map((r) => ({ source: "man", ...r })),
      note: result.truncated
        ? "man results are incomplete — too many pages matched."
        : null,
    };
  }
  return { rows: [], note: "man not searched — no usable grep was found." };
}

// --- HTTP fallback (pages only — background has no muxy.http) ----------------

async function getTldrIndex(config, force = false) {
  const stored = await muxy.storage.get("tldrIndex");
  if (!force && stored && Date.now() - stored.fetchedAt < INDEX_MAX_AGE) return stored;

  try {
    const res = await muxy.http.fetch(INDEX_URL, { timeoutMs: 30000 });
    if (res.status !== 200 || res.truncated) throw new Error(`HTTP ${res.status}`);
    const raw = JSON.parse(res.body);
    const lang = config.lang || "en";
    const entries = raw.commands
      .filter((c) => c.language.includes(lang))
      .map((c) => [c.name, c.platform]);
    const index = { fetchedAt: Date.now(), lang, entries };
    await muxy.storage.set("tldrIndex", index);
    return index;
  } catch {
    return stored ?? null; // stale beats nothing
  }
}

async function fetchTldrHttp(ref, config) {
  const cacheKey = `${ref.lang ?? config.lang}/${ref.platform ?? config.platform}/${ref.name}`;
  const cache = (await muxy.storage.get("pageCache")) ?? {};
  const hit = cache[cacheKey];
  if (hit) {
    touchPageCache(cache, cacheKey, hit);
    return { kind: "tldr", page: parseTldrPage(hit.body), via: "http" };
  }

  const lang = ref.lang ?? config.lang;
  const langDir = lang === "en" ? "pages" : `pages.${lang}`;
  const index = await getTldrIndex(config);
  const known = index?.entries.find(([name]) => name === ref.name)?.[1];

  const tryOrder = [ref.platform ?? config.platform, "common", "linux", "osx"]
    .filter((p, i, a) => p && a.indexOf(p) === i)
    .filter((p) => !known || known.includes(p));
  if (known) tryOrder.push(...known.filter((p) => !tryOrder.includes(p)));

  for (const platform of tryOrder) {
    const url = `https://raw.githubusercontent.com/tldr-pages/tldr/main/${langDir}/` +
      `${platform}/${encodeURIComponent(ref.name)}.md`;
    let res;
    try {
      res = await muxy.http.fetch(url, { timeoutMs: 15000 });
    } catch (err) {
      throw new SourceError("unavailable", `Network fallback failed: ${err?.message ?? err}`);
    }
    if (res.status === 200 && res.body.startsWith("#")) {
      touchPageCache(cache, cacheKey, { body: res.body, fetchedAt: Date.now() });
      return { kind: "tldr", page: parseTldrPage(res.body), via: "http" };
    }
  }
  throw new SourceError("not-found", `No tldr page for “${ref.name}”.`);
}

function touchPageCache(cache, key, entry) {
  delete cache[key];
  cache[key] = { ...entry, usedAt: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > PAGE_CACHE_MAX) {
    keys.sort((a, b) => (cache[a].usedAt ?? 0) - (cache[b].usedAt ?? 0));
    for (const k of keys.slice(0, keys.length - PAGE_CACHE_MAX)) delete cache[k];
  }
  muxy.storage.set("pageCache", cache).catch(() => {});
}

export async function refreshTldrIndex(config) {
  return getTldrIndex(config, true);
}

function firstLine(text) {
  return (text ?? "").split("\n")[0].trim();
}
