import {
  call,
  RedisError,
  isErr,
  isConnError,
  parseInfo,
  parseFields,
  keyspace,
  parseClientList,
  formatReply,
  splitCommandLine,
  parseRedisUrl,
  connUrl,
  showText,
  escapeBinary,
  hostPort,
  escapeGlob,
  formatBytes,
  dockerRedisContainers,
  dockerConnInfo,
} from "./redis.js";
import { icon } from "./icons.js";
import { prettyJson, looksJson } from "./highlight.js";
import { findEnvConnections, isEnvFile } from "./project.js";

// ---------------------------------------------------------------- helpers

const $ = (sel, root = document) => root.querySelector(sel);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const cmp = (a, b) => collator.compare(a || "", b || "");
const plural = (n, word, many = `${word}s`) => `${fmtNum(n)} ${n === 1 ? word : many}`;
const fmtNum = (n) => (typeof n === "number" ? n.toLocaleString() : String(n ?? ""));
const mx = () => window.muxy;
const enc = new TextEncoder();

function attrs(data) {
  return Object.entries(data)
    .filter(([, v]) => v != null)
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join("");
}

function btn(ic, action, title, data = {}, { disabled = false, cls = "" } = {}) {
  return `<button class="icon-btn ${cls}" data-action="${action}" title="${esc(title)}" aria-label="${esc(title)}"${attrs(data)}${disabled ? " disabled" : ""}>${icon(ic)}</button>`;
}

function abtn(ic, action, label, { disabled = false, cls = "", data = {}, title = label } = {}) {
  return `<button class="action-btn ${cls}" data-action="${action}" title="${esc(title)}"${attrs(data)}${disabled ? " disabled" : ""}>${icon(ic)}<span>${esc(label)}</span></button>`;
}

const spinner = (label) => `<span class="busy-inline" title="${esc(label)}"><span class="spin"></span></span>`;

// Compact, for list rows: 45s, 12m, 3h, 2d.
function fmtTtl(ms) {
  if (ms <= 0) return "expired";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// Longer, for details: 4m 12s, 2h 5m, 3d 4h.
function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

// "90", "10m", "2h", "7d", "1500ms" -> milliseconds; empty or "never" -> null.
function parseDuration(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t || /^(never|none|persist|forever|-1|0)$/.test(t)) return null;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)?$/.exec(t);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  const u = (m[2] || "s")[0] === "m" && m[2] !== "ms" ? "m" : m[2] === "ms" ? "ms" : (m[2] || "s")[0];
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[u] || 1000;
  return Math.max(1, Math.round(n * mult));
}

function ago(unixSeconds) {
  const t = Number(unixSeconds) * 1000;
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return "just now";
  return `${fmtDuration(s).split(" ")[0]} ago`;
}

function shq(s) {
  const v = String(s);
  return /^[\w.\/:@%+=,-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`;
}

function preview(v, max = 160) {
  if (v == null) return "(nil)";
  let s = v instanceof Uint8Array ? escapeBinary(v.subarray(0, max)) : String(v).slice(0, max * 2);
  if (!(v instanceof Uint8Array) && looksJsonish(s)) s = s.replace(/\s+/g, " ");
  s = s.replace(/\r?\n/g, "↵ ");
  return s.length > max ? `${s.slice(0, max)}…` : s || "(empty)";
}
const looksJsonish = (s) => /^\s*[[{]/.test(s);

function hexDump(bytes, limit = 16384) {
  const lines = [];
  const n = Math.min(bytes.length, limit);
  for (let o = 0; o < n; o += 16) {
    const row = bytes.subarray(o, Math.min(o + 16, n));
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${o.toString(16).padStart(6, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (bytes.length > n) lines.push(`… ${fmtNum(bytes.length - n)} more bytes`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- state

const VIEWS = [
  { id: "keys", label: "Keys" },
  { id: "console", label: "Console" },
  { id: "server", label: "Server" },
];

const TYPES = {
  string: { tag: "STR", cls: "string", label: "String" },
  hash: { tag: "HASH", cls: "hash", label: "Hash" },
  list: { tag: "LIST", cls: "list", label: "List" },
  set: { tag: "SET", cls: "set", label: "Set" },
  zset: { tag: "ZSET", cls: "zset", label: "Sorted set" },
  stream: { tag: "STRM", cls: "stream", label: "Stream" },
  "ReJSON-RL": { tag: "JSON", cls: "json", label: "JSON" },
  vectorset: { tag: "VEC", cls: "other", label: "Vector set" },
  "TSDB-TYPE": { tag: "TS", cls: "other", label: "Time series" },
  "MBbloom--": { tag: "BF", cls: "other", label: "Bloom filter" },
};
const typeInfo = (t) => TYPES[t] || { tag: String(t || "?").slice(0, 4).toUpperCase(), cls: "other", label: String(t || "unknown") };
const typeTag = (t) => {
  const ti = typeInfo(t);
  return `<span class="type-tag t-${ti.cls}" title="${esc(ti.label)}">${esc(ti.tag)}</span>`;
};

const LOCAL = { id: "local", name: "Local", kind: "tcp", host: "127.0.0.1", port: 6379, username: "", password: "", db: 0, tls: false, tlsInsecure: false };
const SEP = ":";
const PAGE = 500;
const MAX_ROWS = 1500;
const MAX_STRING = 256 * 1024;
const LIST_PAGE = 200;

const state = {
  mode: "sidebar",
  view: "keys",
  saved: [],
  // Passwords typed when Redis asked for one, by connection id, and the
  // ones the user chose to remember (for Docker and .env connections).
  passwords: {},
  storedPasswords: {},
  picks: { global: "", projects: {} },
  dbs: {},
  project: { id: "", name: "", path: "" },
  env: [],
  docker: { status: "idle", containers: [], message: "", loading: false, loaded: false },
  activeId: "",
  target: null,
  conn: { status: "idle", message: "", kind: "", version: "", server: "Redis", mode: "", role: "" },
  db: 0,
  dbCount: 16,
  info: null,
  modules: [],
  samples: [],
  keys: freshKeys(),
  filter: "",
  typeFilter: "",
  tree: true,
  expanded: new Set(),
  detail: null,
  console: { entries: [], history: [], hpos: -1, draft: "", running: false },
  server: { clients: null, slowlog: null, cmdstats: null },
  busy: new Map(),
};

function freshKeys() {
  return { items: [], ids: new Set(), cursor: "0", done: false, loaded: false, loading: false, error: "", seq: 0 };
}

const isOk = () => state.conn.status === "ok" && !!state.target;
const major = () => parseInt(state.conn.version, 10) || 0;
const hasJson = () => state.modules.some((m) => /json/i.test(m)) || (state.conn.server === "Redis" && major() >= 8);

// ---------------------------------------------------------------- storage

const KEYS = { prefs: "prefs", connections: "connections", picks: "picks", passwords: "passwords", history: "history" };

async function readStore(key) {
  try {
    return await mx().storage.get(key);
  } catch (e) {
    console.warn(`[redis] couldn't read ${key}:`, e?.message || e);
    return null;
  }
}

function writeStore(key, value) {
  Promise.resolve()
    .then(() => mx().storage.set(key, value))
    .catch((e) => console.warn(`[redis] couldn't save ${key}:`, e?.message || e));
}

async function loadStored() {
  const [prefs, conns, picks, passwords, history] = await Promise.all(Object.values(KEYS).map(readStore));
  if (prefs && typeof prefs === "object") {
    if (VIEWS.some((v) => v.id === prefs.view)) state.view = prefs.view;
    if (typeof prefs.tree === "boolean") state.tree = prefs.tree;
    if (prefs.dbs && typeof prefs.dbs === "object") state.dbs = prefs.dbs;
  }
  if (Array.isArray(conns)) {
    state.saved = conns.filter((c) => c && c.id && c.host);
  } else {
    state.saved = [{ ...LOCAL }];
    writeStore(KEYS.connections, state.saved);
  }
  if (picks && typeof picks === "object") state.picks = { global: picks.global || "", projects: picks.projects || {} };
  if (passwords && typeof passwords === "object") {
    state.storedPasswords = passwords;
    state.passwords = { ...passwords };
  }
  if (Array.isArray(history)) state.console.history = history.slice(-200);
}

let prefsTimer = 0;
function savePrefs() {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => writeStore(KEYS.prefs, { view: state.view, tree: state.tree, dbs: state.dbs }), 400);
}

const saveConnections = () => writeStore(KEYS.connections, state.saved);

// ---------------------------------------------------------------- connections

function dockerConn(name) {
  const c = state.docker.containers.find((x) => x.name === name);
  return { id: `docker:${name}`, kind: "docker", source: "docker", container: name, image: c?.image || "", project: c?.project || "", service: c?.service || "" };
}

function connById(id) {
  if (!id) return null;
  if (id.startsWith("docker:")) return dockerConn(id.slice(7));
  return state.saved.find((c) => c.id === id) || state.env.find((c) => c.id === id) || null;
}

const isSaved = (c) => !!c && state.saved.some((s) => s.id === c.id);

function connName(c) {
  if (!c) return "No connection";
  if (c.kind === "docker") return c.container;
  if (c.source === "env") return c.envKey;
  return c.name || hostPort(c);
}

function connSub(c) {
  if (!c) return "";
  if (c.kind === "docker") {
    const d = state.docker.containers.find((x) => x.name === c.container);
    if (!d) return "Docker container";
    return [d?.image || c.image, d?.project ? `${d.project}/${d.service}` : "", d?.publishedPort ? `port ${d.publishedPort}` : "not published"].filter(Boolean).join(" · ");
  }
  const where = `${hostPort(c)}${c.db ? `/${c.db}` : ""}${c.tls ? " · TLS" : ""}`;
  return c.source === "env" ? `${where} · ${c.file}` : where;
}

function inProject(d) {
  const p = state.project.path;
  return !!p && !!d.workingDir && (d.workingDir === p || d.workingDir.startsWith(`${p}/`));
}

async function resolveTarget(id) {
  const base = connById(id);
  if (!base) throw new RedisError("That connection no longer exists", "gone");
  let target;
  if (base.kind === "docker") {
    let info;
    try {
      info = await dockerConnInfo(base.container);
    } catch (e) {
      if (e.kind === "daemon") throw new RedisError("Docker isn't running", "docker");
      if (e.kind === "missing" || e.kind === "exec") throw e;
      throw new RedisError(/no such/i.test(e.message) ? `There's no container named ${base.container}` : e.message, "docker");
    }
    if (!info.running) throw new RedisError(`The container ${base.container} isn't running`, "docker");
    target = { ...base, port: info.port, password: info.password, passwordEnv: info.passwordEnv, username: "" };
  } else {
    target = { ...base };
  }
  const typed = state.passwords[id];
  if (typed && typeof typed === "object") {
    target.password = typed.password || "";
    target.username = typed.username || target.username || "";
    target.passwordEnv = "";
  }
  return target;
}

let connectSeq = 0;
let connecting = false;

async function connect(id = state.activeId, { quiet = false } = {}) {
  const seq = ++connectSeq;
  const switching = id !== state.activeId || !state.target;
  state.activeId = id || "";
  if (!id) {
    state.target = null;
    state.conn = { ...state.conn, status: "none", message: "" };
    resetData();
    renderAll();
    return;
  }
  if (!quiet) {
    state.conn = { ...state.conn, status: "connecting", message: "", kind: "" };
    if (switching) resetData();
    renderAll();
  }
  connecting = true;
  try {
    const target = await resolveTarget(id);
    const [pong, infoText, dbs] = await call(target, [["PING"], ["INFO"], ["CONFIG", "GET", "databases"]], { db: 0, timeoutMs: 12000 });
    if (seq !== connectSeq) return;
    if (isErr(pong)) throw new RedisError(pong.message, "protocol");
    const info = isErr(infoText) ? {} : parseInfo(infoText);
    const wasOk = isOk() && state.target?.id === id;
    state.target = target;
    applyInfo(info);
    const n = Array.isArray(dbs) ? Number(showText(dbs[1])) : NaN;
    state.dbCount = info.redis_mode === "cluster" ? 1 : n > 0 ? n : 16;
    const want = Number(state.dbs[id] ?? target.db ?? 0) || 0;
    state.db = want < state.dbCount ? want : 0;
    state.conn = {
      status: "ok",
      message: "",
      kind: "",
      version: info.valkey_version || info.dragonfly_version || info.redis_version || "",
      server: info.valkey_version ? "Valkey" : info.dragonfly_version ? "Dragonfly" : "Redis",
      mode: info.redis_mode || info.server_mode || "standalone",
      role: info.role || "",
    };
    console.log(`[redis] connected to ${connName(target)} (${state.conn.server} ${state.conn.version})`);
    renderAll();
    if (switching || !wasOk) loadKeys({ reset: true });
    else loadKeys({ refresh: true, quiet: true });
    if (state.view === "server") runTask("server");
  } catch (e) {
    if (seq !== connectSeq) return;
    if (!quiet || state.conn.message !== e.message) console.log(`[redis] couldn't connect to ${connName(connById(id))}: ${e.message} (${e.kind})${e.raw ? ` ${String(e.raw).slice(0, 200)}` : ""}`);
    state.target = null;
    setConnError(e);
    renderAll();
    if (!quiet && !state.docker.loaded && (e.kind === "refused" || e.kind === "docker")) loadDocker();
  } finally {
    if (seq === connectSeq) connecting = false;
  }
}

function setConnError(e) {
  const auth = e.kind === "auth" || e.kind === "noauth";
  state.conn = { ...state.conn, status: auth ? "auth" : "error", message: e.message, kind: e.kind, denied: !!e.denied, at: Date.now() };
}

// A call failed because the connection broke: show it, and keep retrying.
function lostConnection(e) {
  if (!state.target) return;
  console.log("[redis] connection lost:", e.message);
  state.target = null;
  setConnError(e);
  if (state.detail && state.detail.kind !== "connections" && state.detail.kind !== "conn-form") closeDetail();
  renderAll();
}

function resetData() {
  state.keys = freshKeys();
  state.info = null;
  state.samples = [];
  state.modules = [];
  state.server = { clients: null, slowlog: null, cmdstats: null };
  state.expanded = new Set();
  if (state.detail?.kind === "key" || state.detail?.kind === "new-key") closeDetail();
}

// The user chose this connection: use it, and remember it for this project.
function useConn(id) {
  state.picks.global = id;
  if (state.project.path) state.picks.projects[state.project.path] = id;
  writeStore(KEYS.picks, state.picks);
  if (state.detail?.kind === "connections") closeDetail();
  connect(id);
}

// Runs commands on the current connection and database.
async function q(cmds, opts = {}) {
  const target = state.target;
  if (!target) throw new RedisError("Not connected", "exec");
  try {
    return await call(target, cmds, { db: state.db, ...opts });
  } catch (e) {
    if (isConnError(e) && state.target === target) lostConnection(e);
    throw e;
  }
}

// One command; an error reply throws.
async function q1(cmd, opts) {
  const [r] = await q([cmd], opts);
  if (isErr(r)) throw new RedisError(r.message.replace(/^ERR\s+/, ""), "command");
  return r;
}

function applyInfo(info) {
  state.info = info;
  state.modules = Object.values(info._sections?.modules || {}).map((v) => String(parseFields(v).name || "")).filter(Boolean);
  state.samples.push({
    ops: +info.instantaneous_ops_per_sec || 0,
    mem: +info.used_memory || 0,
    clients: +info.connected_clients || 0,
    net: (+info.instantaneous_input_kbps || 0) + (+info.instantaneous_output_kbps || 0),
  });
  if (state.samples.length > 60) state.samples.shift();
}

// ---------------------------------------------------------------- project and Docker

async function loadProject() {
  try {
    const list = (await mx().projects.list()) || [];
    const p = list.find((x) => x.isActive) || null;
    state.project = p ? { id: p.id, name: p.name, path: p.path } : { id: "", name: "", path: "" };
  } catch (e) {
    console.warn("[redis] couldn't read the project:", e?.message || e);
  }
}

let envTimer = 0;
function scheduleEnvScan() {
  clearTimeout(envTimer);
  envTimer = setTimeout(scanEnv, 400);
}

async function scanEnv() {
  try {
    state.env = await findEnvConnections(mx());
  } catch {
    state.env = [];
  }
  if (state.detail?.kind === "connections") renderDetail();
  renderList();
}

async function onProjectChanged() {
  const prev = state.project.path;
  await loadProject();
  if (state.project.path === prev) return;
  await scanEnv();
  const pick = state.picks.projects[state.project.path];
  if (pick && pick !== state.activeId && connById(pick)) return connect(pick);
  // exec runs on the project's server, so a remote project can mean another localhost.
  if (state.activeId) connect(state.activeId, { quiet: isOk() });
}

async function loadDocker() {
  const dk = state.docker;
  if (dk.loading) return;
  dk.loading = true;
  renderDockerViews();
  try {
    dk.containers = await dockerRedisContainers();
    dk.status = "ok";
    dk.message = "";
  } catch (e) {
    dk.containers = [];
    dk.status = e.kind === "missing" ? "missing" : e.kind === "daemon" ? "down" : "error";
    dk.message = e.message;
  } finally {
    dk.loading = false;
    dk.loaded = true;
    renderDockerViews();
  }
}

function renderDockerViews() {
  if (state.detail?.kind === "connections") renderDetail();
  if (!isOk()) renderList();
}

// ---------------------------------------------------------------- polling

const TASKS = {
  info: { every: () => (state.view === "server" ? 2000 : 10000), run: loadInfo },
  keys: { every: () => (state.view === "keys" && autoKeys() ? 5000 : 0), run: () => loadKeys({ refresh: true, quiet: true }) },
  server: { every: () => (state.view === "server" ? 5000 : 0), run: loadServerExtras },
  detail: { every: () => (detailAutoRefresh() ? 4000 : 0), run: () => loadKeyDetail({ quiet: true }) },
  docker: { every: () => (state.detail?.kind === "connections" ? 10000 : 0), run: loadDocker },
};
const taskState = {};
let lastReconnect = 0;
const RETRY_KINDS = new Set(["refused", "timeout", "docker", "protocol", "dns", "denied"]);

function pump() {
  if (document.visibilityState === "hidden") return;
  const now = Date.now();
  if (state.conn.status === "error" && RETRY_KINDS.has(state.conn.kind) && !connecting && now - lastReconnect > 5000) {
    lastReconnect = now;
    connect(state.activeId, { quiet: true });
  }
  if (!isOk()) return;
  for (const [name, task] of Object.entries(TASKS)) {
    const every = task.every();
    if (!every) continue;
    const s = (taskState[name] = taskState[name] || { last: 0, busy: false });
    if (s.busy || now - s.last < every) continue;
    runTask(name);
  }
}

async function runTask(name) {
  const s = (taskState[name] = taskState[name] || { last: 0, busy: false });
  if (s.busy) return;
  s.busy = true;
  s.last = Date.now();
  try {
    await TASKS[name].run();
  } catch (e) {
    if (!isConnError(e)) console.warn(`[redis] ${name}:`, e?.message || e);
  } finally {
    s.busy = false;
    s.last = Date.now();
  }
}

const autoKeys = () => {
  const k = state.keys;
  return k.loaded && k.done && !k.loading && k.items.length <= 2000;
};

async function loadInfo() {
  if (!state.target) return;
  const cmds = [["INFO"]];
  if (state.view === "server") cmds.push(["INFO", "commandstats"]);
  const [infoText, cs] = await q(cmds);
  if (isErr(infoText)) return;
  applyInfo(parseInfo(infoText));
  if (cs && !isErr(cs)) state.server.cmdstats = parseCommandStats(cs);
  renderHeader();
  renderTabs();
  renderFooter();
  if (state.view === "server") renderList();
}

function parseCommandStats(text) {
  const out = [];
  for (const [k, v] of Object.entries(parseInfo(text))) {
    const m = /^cmdstat_(.+)$/.exec(k);
    if (!m) continue;
    const f = parseFields(v);
    out.push({ name: m[1].replace("|", " "), calls: f.calls || 0, per: f.usec_per_call || 0, failed: f.failed_calls || 0 });
  }
  return out.sort((a, b) => b.calls - a.calls);
}

async function loadServerExtras() {
  if (!state.target) return;
  const [me, clients, slow] = await q([["CLIENT", "ID"], ["CLIENT", "LIST"], ["SLOWLOG", "GET", "25"]]);
  state.server.clients = isErr(clients)
    ? { error: clients.message }
    : parseClientList(clients).filter((c) => String(c.id) !== String(me));
  state.server.slowlog = isErr(slow)
    ? { error: slow.message }
    : (slow || []).map((e) => ({ id: e[0], at: e[1], us: e[2], args: (e[3] || []).map(showText), client: showText(e[4] || ""), name: showText(e[5] || "") }));
  if (state.view === "server") renderList();
}

// ---------------------------------------------------------------- keys

function matchPattern() {
  const f = state.filter.trim();
  if (!f) return "*";
  return /[*?[]/.test(f) ? f : `*${escapeGlob(f)}*`;
}

const keyId = (key) => (key instanceof Uint8Array ? `b:${Array.from(key, (b) => b.toString(16).padStart(2, "0")).join("")}` : `s:${key}`);

async function keyMeta(keys) {
  const cmds = [];
  for (const key of keys) cmds.push(["TYPE", key], ["PTTL", key]);
  const r = await q(cmds, { timeoutMs: 30000 });
  const now = Date.now();
  const out = [];
  keys.forEach((key, i) => {
    const type = r[i * 2];
    const pttl = r[i * 2 + 1];
    if (type === "none" || pttl === -2) return;
    out.push({ key, id: keyId(key), name: showText(key), type: isErr(type) ? "?" : showText(type), expireAt: typeof pttl === "number" && pttl >= 0 ? now + pttl : null });
  });
  return out;
}

function sortKeys(k = state.keys) {
  k.items.sort((a, b) => cmp(a.name, b.name));
  k.items.forEach((it, i) => (it.idx = i));
}

let keysTimer = 0;
function scheduleKeys() {
  clearTimeout(keysTimer);
  keysTimer = setTimeout(() => loadKeys({ reset: true }), 300);
}

// reset: start over. more: the next page. refresh: rescan as many keys as
// are shown and swap them in when done, so the list doesn't flicker.
async function loadKeys({ reset = false, more = false, refresh = false, quiet = false } = {}) {
  if (!state.target) return;
  const k = state.keys;
  const seq = ++k.seq;
  const pattern = matchPattern();
  const type = state.typeFilter;
  if (reset) Object.assign(k, { items: [], ids: new Set(), cursor: "0", done: false, loaded: false, error: "" });
  const into = refresh ? { items: [], ids: new Set(), cursor: "0", done: false } : k;
  const want = more ? k.items.length + PAGE : refresh ? Math.max(PAGE, k.items.length) : PAGE;
  k.loading = true;
  if (!quiet) renderKeysView();
  try {
    let rounds = 0;
    while (!into.done && into.items.length < want && rounds < 60) {
      const args = ["SCAN", into.cursor, "MATCH", pattern, "COUNT", "1000"];
      if (type) args.push("TYPE", type);
      const [r] = await q([args], { timeoutMs: 30000 });
      if (seq !== k.seq) return;
      if (isErr(r)) throw new RedisError(r.message.replace(/^ERR\s+/, ""), "command");
      into.cursor = showText(r[0]);
      into.done = into.cursor === "0";
      const fresh = [];
      for (const key of r[1] || []) {
        const id = keyId(key);
        if (into.ids.has(id)) continue;
        into.ids.add(id);
        fresh.push(key);
      }
      if (fresh.length) {
        const metas = await keyMeta(fresh);
        if (seq !== k.seq) return;
        into.items.push(...metas);
      }
      rounds++;
      if (into === k) {
        sortKeys();
        renderKeysView();
      }
    }
    if (into !== k) Object.assign(k, { items: into.items, ids: into.ids, cursor: into.cursor, done: into.done });
    sortKeys();
    k.loaded = true;
    k.error = "";
  } catch (e) {
    if (seq !== k.seq) return;
    if (!isConnError(e)) {
      k.error = e.message;
      k.loaded = true;
    }
  } finally {
    if (seq === k.seq) {
      k.loading = false;
      renderKeysView();
    }
  }
}

function renderKeysView() {
  if (state.view !== "keys") return renderTabs();
  renderTabs();
  renderToolbar();
  renderList();
}

// Keep a row in step with what the detail view learned.
function updateKeyItem(d) {
  const it = state.keys.items.find((x) => x.id === d.id);
  if (!it) return;
  const changed = it.type !== d.type || it.expireAt !== d.expireAt;
  it.type = d.type;
  it.expireAt = d.expireAt;
  if (changed) renderList();
}

function dropKeyItem(id) {
  const k = state.keys;
  const i = k.items.findIndex((x) => x.id === id);
  if (i < 0) return;
  k.items.splice(i, 1);
  k.ids.delete(id);
  sortKeys();
  renderList();
}

function buildTree(items) {
  const root = { name: "", path: "", folders: new Map(), leaves: [], count: 0 };
  for (const it of items) {
    const parts = it.name.split(SEP);
    let node = root;
    let path = "";
    for (let i = 0; i < parts.length - 1; i++) {
      path += parts[i] + SEP;
      let child = node.folders.get(parts[i]);
      if (!child) {
        child = { name: parts[i], path, folders: new Map(), leaves: [], count: 0 };
        node.folders.set(parts[i], child);
      }
      child.count++;
      node = child;
    }
    node.leaves.push({ it, label: parts[parts.length - 1] });
  }
  return root;
}

// ---------------------------------------------------------------- key details

function detailAutoRefresh() {
  const d = state.detail;
  if (!d || d.kind !== "key" || d.editing || d.adding || d.renaming || d.loading || d.gone || !d.data) return false;
  if (hasSelectionIn($("#d-body"))) return false;
  const data = d.data;
  if (data.kind === "hash" || data.kind === "set") return data.done && data.length <= 1000;
  return true;
}

function hasSelectionIn(el) {
  const sel = window.getSelection();
  return !!(el && sel && !sel.isCollapsed && el.contains(sel.anchorNode));
}

function openKey(it) {
  closeMenu();
  state.detail = {
    kind: "key",
    key: it.key,
    id: it.id,
    name: it.name,
    type: it.type,
    expireAt: it.expireAt,
    memory: null,
    encoding: "",
    data: null,
    error: "",
    gone: false,
    loading: true,
    open: new Set(),
    editing: null,
    adding: false,
    renaming: false,
    format: "auto",
    desc: false,
    q: "",
    seq: 0,
  };
  showDetail();
  renderList();
  loadKeyDetail();
}

async function loadKeyDetail({ quiet = false, more = false } = {}) {
  const d = state.detail;
  if (!d || d.kind !== "key") return;
  const seq = ++d.seq;
  if (!quiet && !more) {
    d.loading = true;
    renderDetail();
  }
  if (more) {
    d.loadingMore = true;
    renderDetailBody();
  }
  try {
    const [type, pttl, mem, encoding] = await q([["TYPE", d.key], ["PTTL", d.key], ["MEMORY", "USAGE", d.key], ["OBJECT", "ENCODING", d.key]]);
    if (state.detail !== d || seq !== d.seq) return;
    if (type === "none" || pttl === -2) {
      Object.assign(d, { gone: true, loading: false, loadingMore: false, data: null });
      dropKeyItem(d.id);
      return renderDetail();
    }
    if (d.type !== showText(type)) d.data = null;
    d.type = showText(type);
    d.expireAt = typeof pttl === "number" && pttl >= 0 ? Date.now() + pttl : null;
    d.memory = typeof mem === "number" ? mem : null;
    d.encoding = isErr(encoding) || encoding == null ? "" : showText(encoding);
    const data = await loadValue(d, { more, quiet });
    if (state.detail !== d || seq !== d.seq) return;
    Object.assign(d, { data, error: "", gone: false, loading: false, loadingMore: false });
    updateKeyItem(d);
  } catch (e) {
    if (state.detail !== d || seq !== d.seq) return;
    Object.assign(d, { loading: false, loadingMore: false, error: e.message });
  }
  renderDetail();
}

async function loadValue(d, { more, quiet }) {
  const key = d.key;
  const prev = d.data && d.data.kind === kindFor(d.type) ? d.data : null;
  switch (d.type) {
    case "string": {
      const [len, val] = await q([["STRLEN", key], ["GETRANGE", key, "0", String(MAX_STRING - 1)]]);
      return { kind: "string", value: isErr(val) ? null : val, length: len, truncated: len > MAX_STRING };
    }
    case "hash":
    case "set": {
      const hash = d.type === "hash";
      const data = more && prev ? prev : { kind: d.type, entries: [], seen: new Set(), cursor: "0", done: false, length: 0 };
      const [len] = await q([[hash ? "HLEN" : "SCARD", key]]);
      data.length = len;
      const want = data.entries.length + 500;
      let rounds = 0;
      while (!data.done && data.entries.length < want && rounds < 30) {
        const [r] = await q([[hash ? "HSCAN" : "SSCAN", key, data.cursor, "COUNT", "500"]]);
        if (isErr(r)) throw new RedisError(r.message, "command");
        data.cursor = showText(r[0]);
        data.done = data.cursor === "0";
        const arr = r[1] || [];
        for (let i = 0; i < arr.length; i += hash ? 2 : 1) {
          const id = keyId(arr[i]);
          if (data.seen.has(id)) continue;
          data.seen.add(id);
          data.entries.push(hash ? [arr[i], arr[i + 1]] : [arr[i]]);
        }
        rounds++;
      }
      data.entries.sort((a, b) => cmp(showText(a[0]), showText(b[0])));
      return data;
    }
    case "list": {
      const count = more && prev ? prev.entries.length + LIST_PAGE : Math.max(LIST_PAGE, quiet && prev ? prev.entries.length : 0);
      const [len, items] = await q([["LLEN", key], ["LRANGE", key, "0", String(count - 1)]]);
      if (isErr(items)) throw new RedisError(items.message, "command");
      return { kind: "list", length: len, entries: items.map((v, i) => [i, v]), done: items.length >= len };
    }
    case "zset": {
      const count = more && prev ? prev.entries.length + LIST_PAGE : Math.max(LIST_PAGE, quiet && prev ? prev.entries.length : 0);
      const [len, items] = await q([["ZCARD", key], [d.desc ? "ZREVRANGE" : "ZRANGE", key, "0", String(count - 1), "WITHSCORES"]]);
      if (isErr(items)) throw new RedisError(items.message, "command");
      const entries = [];
      for (let i = 0; i < items.length; i += 2) entries.push([items[i], showText(items[i + 1])]);
      return { kind: "zset", length: len, entries, done: entries.length >= len };
    }
    case "stream": {
      const count = Math.min(1000, more && prev ? prev.entries.length + 50 : Math.max(50, quiet && prev ? prev.entries.length : 0));
      const [len, items, groups] = await q([["XLEN", key], ["XREVRANGE", key, "+", "-", "COUNT", String(count)], ["XINFO", "GROUPS", key]]);
      if (isErr(items)) throw new RedisError(items.message, "command");
      return {
        kind: "stream",
        length: len,
        entries: items.map(([id, fields]) => [showText(id), fields || []]),
        groups: isErr(groups) ? [] : (groups || []).map(pairsToObject),
        done: items.length >= len || count >= 1000,
      };
    }
    case "ReJSON-RL": {
      const [v] = await q([["JSON.GET", key]]);
      if (isErr(v)) return { kind: "json", error: v.message };
      return { kind: "json", value: v };
    }
    default:
      return { kind: "other" };
  }
}

const kindFor = (type) => (type === "ReJSON-RL" ? "json" : ["string", "hash", "set", "list", "zset", "stream"].includes(type) ? type : "other");

function pairsToObject(arr) {
  const o = {};
  for (let i = 0; i + 1 < (arr || []).length; i += 2) o[showText(arr[i])] = arr[i + 1];
  return o;
}

// ---------------------------------------------------------------- key actions

async function setTtl(key, name, expireAt) {
  const left = expireAt ? fmtDuration((expireAt - Date.now()) / 1000) : "";
  const answer = await prompt({
    title: `Expire “${name}” after…`,
    message: `${left ? `It expires in ${left}.` : "It never expires."} Enter a time like 90, 10m, 2h or 7d. Leave it empty to keep the key forever.`,
    placeholder: left ? left.replace(" ", "") : "10m",
  });
  if (answer == null) return;
  const ms = parseDuration(answer);
  if (Number.isNaN(ms)) return toast("Use a time like 90, 10m, 2h or 7d", { kind: "error" });
  await busy("key", "Saving", async () => {
    const r = await q1(ms == null ? ["PERSIST", key] : ["PEXPIRE", key, String(ms)]);
    if (ms != null && r === 0) throw new RedisError("The key no longer exists");
    toast(ms == null ? "The key no longer expires" : `Expires in ${fmtDuration(ms / 1000)}`);
    const it = state.keys.items.find((x) => x.id === keyId(key));
    if (it) it.expireAt = ms == null ? null : Date.now() + ms;
    renderList();
    if (state.detail?.kind === "key" && state.detail.id === keyId(key)) await loadKeyDetail({ quiet: true });
  });
}

async function deleteKey(key, name) {
  const ok = await confirm({
    title: `Delete “${name}”?`,
    message: `From db${state.db} on ${connName(state.target)}. This can't be undone.`,
    buttons: ["Delete", "Cancel"],
    default: "Delete",
    cancel: "Cancel",
  });
  if (ok !== "Delete") return;
  await busy("key", "Deleting", async () => {
    const [r] = await q([["UNLINK", key]]);
    if (isErr(r)) await q1(["DEL", key]);
    if (state.detail?.kind === "key" && state.detail.id === keyId(key)) closeDetail();
    dropKeyItem(keyId(key));
    toast(`Deleted ${name}`);
    kickInfo();
  });
}

async function renameKey(newName) {
  const d = state.detail;
  if (!d || d.kind !== "key") return;
  d.renaming = false;
  if (!newName || newName === d.name) return renderDetailChrome();
  await busy("key", "Renaming", async () => {
    let r = await q1(["RENAMENX", d.key, newName]);
    if (r === 0) {
      const ok = await confirm({
        title: `Replace “${newName}”?`,
        message: "A key with that name already exists. Renaming replaces it.",
        buttons: ["Replace", "Cancel"],
        default: "Cancel",
        cancel: "Cancel",
      });
      if (ok !== "Replace") return;
      r = await q1(["RENAME", d.key, newName]);
    }
    const oldId = d.id;
    Object.assign(d, { key: newName, name: newName, id: keyId(newName) });
    dropKeyItem(oldId);
    toast(`Renamed to ${newName}`);
    loadKeys({ refresh: true, quiet: true });
  });
  renderDetail();
}

async function copyKeyTo(key, name) {
  const target = await prompt({ title: `Copy “${name}” to…`, message: "The new key's name. COPY needs Redis 6.2 or later.", placeholder: `${name}:copy` });
  if (!target) return;
  await busy("key", "Copying", async () => {
    const r = await q1(["COPY", key, target]);
    if (r === 0) throw new RedisError(`${target} already exists`);
    toast(`Copied to ${target}`);
    loadKeys({ refresh: true, quiet: true });
  });
}

async function deleteMatching(pattern) {
  await busy("scan-delete", "Counting keys", async () => {
    const found = new Map();
    let cursor = "0";
    let rounds = 0;
    do {
      const [r] = await q([["SCAN", cursor, "MATCH", pattern, "COUNT", "1000"]], { timeoutMs: 30000 });
      if (isErr(r)) throw new RedisError(r.message, "command");
      cursor = showText(r[0]);
      for (const key of r[1] || []) found.set(keyId(key), key);
      rounds++;
    } while (cursor !== "0" && found.size < 100000 && rounds < 2000);
    const keys = [...found.values()];
    if (!keys.length) return toast(`No keys match ${pattern}`);
    const ok = await confirm({
      title: `Delete ${plural(keys.length, "key")}?`,
      message: `Every key in db${state.db} on ${connName(state.target)} that matches ${pattern}${cursor !== "0" ? " (counting stopped at 100,000)" : ""}. This can't be undone.`,
      buttons: ["Delete", "Cancel"],
      default: "Cancel",
      cancel: "Cancel",
    });
    if (ok !== "Delete") return;
    for (let i = 0; i < keys.length; i += 500) {
      const [r] = await q([["UNLINK", ...keys.slice(i, i + 500)]], { timeoutMs: 60000 });
      if (isErr(r)) await q1(["DEL", ...keys.slice(i, i + 500)], { timeoutMs: 60000 });
    }
    toast(`Deleted ${plural(keys.length, "key")}`);
    loadKeys({ refresh: true });
    kickInfo();
  });
}

async function flushDb() {
  const n = keyspace(state.info)[state.db]?.keys || 0;
  const ok = await confirm({
    title: `Delete all ${plural(n, "key")} in db${state.db}?`,
    message: `This runs FLUSHDB on ${connName(state.target)}. It can't be undone.`,
    buttons: ["Delete All", "Cancel"],
    default: "Cancel",
    cancel: "Cancel",
  });
  if (ok !== "Delete All") return;
  await busy("flush", "Deleting", async () => {
    await q1(["FLUSHDB"], { timeoutMs: 120000 });
    toast(`db${state.db} is empty`);
    if (state.detail?.kind === "key") closeDetail();
    loadKeys({ reset: true });
    kickInfo();
  });
}

const kickInfo = () => runTask("info");

function selectDb(n, { quiet = false } = {}) {
  if (n === state.db) return;
  state.db = n;
  state.dbs[state.activeId] = n;
  savePrefs();
  if (state.detail?.kind === "key") closeDetail();
  state.expanded = new Set();
  if (!quiet) toast(`Switched to db${n}`);
  renderAll();
  loadKeys({ reset: true });
}

// Saves the string or JSON value being edited.
async function saveValue(text) {
  const d = state.detail;
  if (d.type === "ReJSON-RL") {
    try {
      JSON.parse(text);
    } catch (e) {
      return toast(`That isn't valid JSON: ${e.message}`, { kind: "error", timeout: 6000 });
    }
  }
  await busy("key", "Saving", async () => {
    if (d.type === "ReJSON-RL") {
      await q1(["JSON.SET", d.key, "$", text]);
    } else if (major() >= 6 || state.conn.server !== "Redis") {
      await q1(["SET", d.key, text, "KEEPTTL"]);
    } else {
      const left = d.expireAt ? Math.max(1, d.expireAt - Date.now()) : 0;
      await q1(["SET", d.key, text]);
      if (left) await q1(["PEXPIRE", d.key, String(left)]);
    }
    d.editing = null;
    toast("Saved");
    await loadKeyDetail({ quiet: true });
  });
  renderDetail({ force: true });
}

// Adds what the inline form describes to the open hash, list, set, zset or stream.
async function addItem(form) {
  const d = state.detail;
  const v = (name) => form.querySelector(`[name="${name}"]`)?.value ?? "";
  let cmd;
  let check = null;
  switch (d.type) {
    case "hash":
      if (!v("field")) return toast("Give the field a name", { kind: "error" });
      cmd = ["HSETNX", d.key, v("field"), v("value")];
      check = (r) => r === 0 && `${v("field")} is already a field. Edit it instead.`;
      break;
    case "list":
      cmd = [v("where") === "head" ? "LPUSH" : "RPUSH", d.key, v("value")];
      break;
    case "set":
      cmd = ["SADD", d.key, v("value")];
      check = (r) => r === 0 && "That's already a member";
      break;
    case "zset": {
      const score = v("score").trim();
      if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$|^[-+]?inf$/i.test(score)) return toast("The score must be a number", { kind: "error" });
      cmd = ["ZADD", d.key, score, v("value")];
      break;
    }
    case "stream": {
      const fields = parseFieldLines(v("fields"));
      if (!fields.length) return toast("Add at least one field, like status=paid", { kind: "error" });
      cmd = ["XADD", d.key, v("id").trim() || "*", ...fields];
      break;
    }
    default:
      return;
  }
  await busy("key", "Adding", async () => {
    const r = await q1(cmd);
    const why = check?.(r);
    if (why) throw new RedisError(why);
    d.adding = false;
    toast("Added");
    await loadKeyDetail({ quiet: true });
  });
  renderDetail({ force: true });
}

// "field=value" or "field value", one per line.
function parseFieldLines(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const m = /^([^=\s]+)\s*(?:=|\s)\s*(.*)$/.exec(t);
    if (m) out.push(m[1], m[2]);
    else out.push(t, "");
  }
  return out;
}

async function saveItem(i, form) {
  const d = state.detail;
  const e = d.data.entries[i];
  if (!e) return;
  const v = (name) => form.querySelector(`[name="${name}"]`)?.value ?? "";
  const value = v("value");
  let cmds;
  switch (d.type) {
    case "hash":
      cmds = [["HSET", d.key, e[0], value]];
      break;
    case "list":
      cmds = [["LSET", d.key, String(e[0]), value]];
      break;
    case "set":
      if (value === showText(e[0])) return cancelEdit();
      cmds = [["MULTI"], ["SREM", d.key, e[0]], ["SADD", d.key, value], ["EXEC"]];
      break;
    case "zset": {
      const score = v("score").trim();
      if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$|^[-+]?inf$/i.test(score)) return toast("The score must be a number", { kind: "error" });
      cmds = value === showText(e[0]) ? [["ZADD", d.key, score, e[0]]] : [["MULTI"], ["ZREM", d.key, e[0]], ["ZADD", d.key, score, value], ["EXEC"]];
      break;
    }
    default:
      return;
  }
  await busy("key", "Saving", async () => {
    const replies = await q(cmds);
    const bad = replies.find((r) => isErr(r)) || (Array.isArray(replies[replies.length - 1]) && replies[replies.length - 1].find((r) => isErr(r)));
    if (bad) throw new RedisError(bad.message.replace(/^ERR\s+/, ""), "command");
    d.editing = null;
    toast("Saved");
    await loadKeyDetail({ quiet: true });
  });
  renderDetail({ force: true });
}

function cancelEdit() {
  const d = state.detail;
  if (!d) return;
  d.editing = null;
  d.adding = false;
  renderDetail({ force: true });
}

async function deleteItem(i) {
  const d = state.detail;
  const e = d.data?.entries[i];
  if (!e) return;
  const what = { hash: `the field “${showText(e[0])}”`, list: `item ${e[0]}`, set: `“${preview(e[0], 60)}”`, zset: `“${preview(e[0], 60)}”`, stream: `entry ${e[0]}` }[d.type];
  const ok = await confirm({ title: `Remove ${what}?`, message: `From ${d.name}.`, buttons: ["Remove", "Cancel"], default: "Remove", cancel: "Cancel" });
  if (ok !== "Remove") return;
  let cmds;
  switch (d.type) {
    case "hash":
      cmds = [["HDEL", d.key, e[0]]];
      break;
    case "set":
      cmds = [["SREM", d.key, e[0]]];
      break;
    case "zset":
      cmds = [["ZREM", d.key, e[0]]];
      break;
    case "stream":
      cmds = [["XDEL", d.key, e[0]]];
      break;
    case "list": {
      // Lists remove by value, so mark the item first and remove the mark.
      const mark = `__muxy_removed_${Math.random().toString(36).slice(2)}__`;
      cmds = [["MULTI"], ["LSET", d.key, String(e[0]), mark], ["LREM", d.key, "1", mark], ["EXEC"]];
      break;
    }
    default:
      return;
  }
  await busy("key", "Removing", async () => {
    const replies = await q(cmds);
    const bad = replies.find((r) => isErr(r));
    if (bad) throw new RedisError(bad.message.replace(/^ERR\s+/, ""), "command");
    d.open = new Set();
    toast("Removed");
    await loadKeyDetail({ quiet: true });
  });
  renderDetail({ force: true });
}

// ---------------------------------------------------------------- new key

const NEW_TYPES = ["string", "hash", "list", "set", "zset", "stream", "ReJSON-RL"];

function openNewKey(prefix = "") {
  if (!isOk()) return;
  closeMenu();
  state.detail = { kind: "new-key", type: "string", draft: { name: prefix }, error: "" };
  showDetail();
}

function readDraft(form) {
  const d = state.detail;
  for (const el of form.querySelectorAll("[name]")) d.draft[el.name] = el.value;
}

async function createKey(form) {
  const d = state.detail;
  readDraft(form);
  const f = d.draft;
  const name = f.name || "";
  const fail = (msg) => {
    d.error = msg;
    renderDetailBody({ force: true });
  };
  if (!name) return fail("Give the key a name.");
  const ttl = parseDuration(f.ttl);
  if (Number.isNaN(ttl)) return fail("Use a time like 90, 10m, 2h or 7d, or leave it empty.");
  let cmd;
  switch (d.type) {
    case "string":
      cmd = ["SET", name, f.value || "", "NX"];
      break;
    case "hash":
      if (!f.field) return fail("Give the first field a name.");
      cmd = ["HSET", name, f.field, f.value || ""];
      break;
    case "list":
      cmd = ["RPUSH", name, f.value || ""];
      break;
    case "set":
      cmd = ["SADD", name, f.value || ""];
      break;
    case "zset":
      if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(String(f.score || "").trim())) return fail("The score must be a number.");
      cmd = ["ZADD", name, String(f.score).trim(), f.value || ""];
      break;
    case "stream": {
      const fields = parseFieldLines(f.fields || "");
      if (!fields.length) return fail("Add at least one field, like status=paid.");
      cmd = ["XADD", name, "*", ...fields];
      break;
    }
    case "ReJSON-RL":
      try {
        JSON.parse(f.value || "");
      } catch (e) {
        return fail(`That isn't valid JSON: ${e.message}`);
      }
      cmd = ["JSON.SET", name, "$", f.value, "NX"];
      break;
    default:
      return;
  }
  await busy("new-key", "Creating", async () => {
    if (d.type !== "string" && d.type !== "ReJSON-RL" && (await q1(["EXISTS", name]))) return fail(`${name} already exists.`);
    const r = await q1(cmd);
    if (r == null) return fail(`${name} already exists.`);
    if (ttl != null) await q1(["PEXPIRE", name, String(ttl)]);
    toast(`Created ${name}`);
    closeDetail();
    openKey({ key: name, id: keyId(name), name, type: d.type, expireAt: ttl ? Date.now() + ttl : null });
    loadKeys({ refresh: true, quiet: true });
    kickInfo();
  });
}

// ---------------------------------------------------------------- connection form

function openConnections() {
  closeMenu();
  state.detail = { kind: "connections" };
  showDetail();
  loadDocker();
  scanEnv();
}

function openConnForm(id = null, preset = null) {
  closeMenu();
  const c = id ? state.saved.find((x) => x.id === id) : null;
  const draft = c ? { ...c } : { ...LOCAL, id: null, name: "", ...(preset || {}) };
  state.detail = { kind: "conn-form", id: c?.id || null, draft, back: state.detail?.kind === "connections" ? "connections" : null };
  showDetail();
}

function readConnForm(form) {
  const v = (n) => form.querySelector(`[name="${n}"]`);
  const host = v("host").value.trim();
  const port = Number(v("port").value.trim() || 6379);
  const db = Number(v("db").value.trim() || 0);
  if (!host) throw new Error("Enter a host, like 127.0.0.1");
  if (!(port >= 1 && port <= 65535 && Number.isInteger(port))) throw new Error("The port must be a number from 1 to 65535");
  if (!(db >= 0 && Number.isInteger(db))) throw new Error("The database must be 0 or more");
  return {
    name: v("name").value.trim(),
    host,
    port,
    username: v("username").value.trim(),
    password: v("password").value,
    db,
    tls: v("tls").checked,
    tlsInsecure: v("tls").checked && v("tlsInsecure").checked,
    kind: "tcp",
  };
}

function setTestResult(kind, html) {
  const el = $("#conn-test");
  if (!el) return;
  el.className = `test-result ${kind}`;
  el.innerHTML = html;
}

async function testConnForm(form) {
  let c;
  try {
    c = readConnForm(form);
  } catch (e) {
    return setTestResult("bad", `${icon("alert")}<span>${esc(e.message)}</span>`);
  }
  setTestResult("pending", `<span class="spin"></span><span>Connecting to ${esc(hostPort(c))}…</span>`);
  try {
    const t0 = performance.now();
    const [, info, size] = await call(c, [["PING"], ["INFO", "server"], ["DBSIZE"]], { timeoutMs: 12000 });
    const i = isErr(info) ? {} : parseInfo(info);
    const ms = Math.round(performance.now() - t0);
    const name = i.valkey_version ? `Valkey ${i.valkey_version}` : i.redis_version ? `Redis ${i.redis_version}` : "Redis";
    setTestResult("ok", `${icon("check")}<span>${esc(name)} · ${esc(isErr(size) ? "" : plural(size, "key"))} in db${c.db} · ${ms} ms</span>`);
  } catch (e) {
    setTestResult("bad", `${icon("alert")}<span>${esc(e.message)}</span>`);
  }
}

function saveConnForm(form) {
  const d = state.detail;
  let c;
  try {
    c = readConnForm(form);
  } catch (e) {
    return setTestResult("bad", `${icon("alert")}<span>${esc(e.message)}</span>`);
  }
  const id = d.id || `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const entry = { ...c, id };
  const i = state.saved.findIndex((x) => x.id === id);
  if (i >= 0) state.saved[i] = entry;
  else state.saved.push(entry);
  saveConnections();
  delete state.passwords[id];
  if (id === state.activeId) delete state.dbs[id];
  closeDetail();
  toast(d.id ? "Saved the connection" : `Added ${connName(entry)}`);
  useConn(id);
}

async function removeConn(id) {
  const c = state.saved.find((x) => x.id === id);
  if (!c) return;
  const ok = await confirm({ title: `Remove “${connName(c)}”?`, message: "This only forgets the connection. Nothing changes in Redis.", buttons: ["Remove", "Cancel"], default: "Remove", cancel: "Cancel" });
  if (ok !== "Remove") return;
  state.saved = state.saved.filter((x) => x.id !== id);
  saveConnections();
  for (const [path, pick] of Object.entries(state.picks.projects)) if (pick === id) delete state.picks.projects[path];
  if (state.picks.global === id) state.picks.global = "";
  writeStore(KEYS.picks, state.picks);
  if (state.detail?.kind === "conn-form") closeDetail();
  toast(`Removed ${connName(c)}`);
  if (state.activeId === id) connect(state.saved[0]?.id || "");
  else if (state.detail?.kind === "connections") renderDetail();
}

function saveAsConnection(id) {
  const c = connById(id);
  if (!c || c.kind === "docker") return;
  openConnForm(null, { ...c, id: null, source: undefined, name: `${c.envKey} (${c.file})` });
}

async function submitAuth(form) {
  const id = state.activeId;
  const password = form.querySelector('[name="password"]').value;
  const username = form.querySelector('[name="username"]').value.trim();
  const remember = form.querySelector('[name="remember"]').checked;
  if (!password) return;
  const c = connById(id);
  if (isSaved(c) && remember) {
    Object.assign(c, { password, username });
    saveConnections();
    delete state.passwords[id];
  } else {
    state.passwords[id] = { password, username };
    if (!isSaved(c)) {
      if (remember) state.storedPasswords[id] = { password, username };
      else delete state.storedPasswords[id];
      writeStore(KEYS.passwords, state.storedPasswords);
    }
  }
  await connect(id);
}

// ---------------------------------------------------------------- redis-cli

function cliCommand(t) {
  if (t.kind === "docker") {
    const args = ["redis-cli"];
    if (t.port !== 6379) args.push("-p", String(t.port));
    if (state.db) args.push("-n", String(state.db));
    if (t.password && !t.passwordEnv) args.push("--askpass");
    const cli = args.join(" ");
    if (t.passwordEnv) return `docker exec -it ${shq(t.container)} sh -c ${shq(`REDISCLI_AUTH="$${t.passwordEnv}" exec ${cli}`)}`;
    return `docker exec -it ${shq(t.container)} ${cli}`;
  }
  const args = ["redis-cli", "-h", t.host || "127.0.0.1", "-p", String(t.port || 6379)];
  if (t.username) args.push("--user", t.username);
  if (t.password) args.push("--askpass");
  if (t.tls) args.push("--tls");
  if (t.tlsInsecure) args.push("--insecure");
  if (state.db) args.push("-n", String(state.db));
  return args.map(shq).join(" ");
}

async function openCli() {
  const t = state.target;
  if (!t) return;
  try {
    await mx().tabs.open({ kind: "terminal", command: cliCommand(t) });
  } catch (e) {
    toastError(e, "Couldn't open a terminal");
  }
}

// ---------------------------------------------------------------- console

const STREAMING = new Set(["SUBSCRIBE", "PSUBSCRIBE", "SSUBSCRIBE", "MONITOR", "SYNC", "PSYNC", "REPLCONF"]);
const DANGEROUS = new Set(["FLUSHALL", "FLUSHDB", "SHUTDOWN", "SWAPDB", "MIGRATE", "REPLICAOF", "SLAVEOF", "FAILOVER", "DEBUG"]);
const DANGEROUS_SUB = {
  CONFIG: ["SET", "REWRITE", "RESETSTAT"],
  SCRIPT: ["FLUSH"],
  FUNCTION: ["FLUSH", "DELETE", "RESTORE"],
  CLUSTER: ["RESET", "FAILOVER", "FORGET", "FLUSHSLOTS", "DELSLOTS"],
  ACL: ["DELUSER", "SETUSER", "LOAD"],
  CLIENT: ["KILL", "PAUSE"],
  MODULE: ["LOAD", "UNLOAD"],
};
const READONLY = new Set(
  "GET MGET STRLEN GETRANGE EXISTS TYPE TTL PTTL EXPIRETIME PEXPIRETIME DBSIZE SCAN KEYS RANDOMKEY DUMP OBJECT MEMORY HGET HMGET HGETALL HKEYS HVALS HLEN HEXISTS HSTRLEN HSCAN HRANDFIELD LRANGE LLEN LINDEX LPOS SMEMBERS SCARD SISMEMBER SMISMEMBER SRANDMEMBER SSCAN SINTER SUNION SDIFF ZRANGE ZREVRANGE ZRANGEBYSCORE ZREVRANGEBYSCORE ZRANGEBYLEX ZSCORE ZMSCORE ZCARD ZCOUNT ZRANK ZREVRANK ZSCAN ZLEXCOUNT XRANGE XREVRANGE XLEN XINFO XPENDING JSON.GET JSON.TYPE JSON.STRLEN JSON.ARRLEN JSON.OBJKEYS JSON.OBJLEN JSON.MGET BITCOUNT BITPOS GETBIT PFCOUNT GEOPOS GEODIST GEOSEARCH GEOHASH INFO PING ECHO TIME LASTSAVE ROLE COMMAND CLIENT SLOWLOG LATENCY HELLO AUTH SELECT LOLWUT".split(" ")
);

const HELP = [
  "Type any command, like GET user:1 or HGETALL user:1.",
  `Quotes work like redis-cli: "two words", 'it\\'s', "\\x00".`,
  "Lines run together on one connection, so paste MULTI … EXEC as one block.",
  "Enter runs · Shift+Enter adds a line · ↑ ↓ go through history · clear empties this view.",
].join("\n");

function isDangerous(p) {
  if (DANGEROUS.has(p.name)) return true;
  const sub = DANGEROUS_SUB[p.name];
  return !!sub && p.args.length > 1 && sub.includes(showText(p.args[1]).toUpperCase());
}

const promptText = (db) => `db${db}>`;
let entrySeq = 0;

function addEntry(e) {
  const c = state.console;
  const entry = { id: ++entrySeq, prompt: promptText(state.db), out: null, kind: "ok", ms: null, pending: false, ...e };
  c.entries.push(entry);
  if (c.entries.length > 300) c.entries.splice(0, c.entries.length - 300);
  return entry;
}

function pushHistory(text) {
  const h = state.console.history;
  if (h[h.length - 1] !== text) h.push(text);
  if (h.length > 200) h.splice(0, h.length - 200);
  writeStore(KEYS.history, h);
}

async function runConsole(text) {
  const c = state.console;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
  if (!lines.length || c.running) return false;
  pushHistory(text.trim());
  c.hpos = -1;
  c.draft = "";
  const done = () => {
    renderList();
    scrollConsole();
    return true;
  };
  if (lines.length === 1 && /^(clear|cls)$/i.test(lines[0])) {
    c.entries = [];
    return done();
  }
  if (lines.length === 1 && /^help$/i.test(lines[0])) {
    addEntry({ cmd: lines[0], out: HELP, kind: "info" });
    return done();
  }
  if (!state.target) {
    addEntry({ cmd: lines.join("\n"), out: "(error) Not connected", kind: "err" });
    return done();
  }
  const parsed = [];
  for (const line of lines) {
    try {
      const args = splitCommandLine(line);
      if (args.length) parsed.push({ line, args, name: showText(args[0]).toUpperCase() });
    } catch (e) {
      addEntry({ cmd: line, out: `(error) ${e.message}`, kind: "err" });
      return done();
    }
  }
  const streaming = parsed.find((p) => STREAMING.has(p.name));
  if (streaming) {
    addEntry({ cmd: streaming.line, out: `${streaming.name} keeps a connection open, which the console can't do. Use “Open redis-cli in a Terminal” from the ⋯ menu.`, kind: "err" });
    return done();
  }
  if (parsed.length === 1 && parsed[0].name === "MULTI") {
    addEntry({ cmd: parsed[0].line, out: "Each run uses its own connection, so run MULTI, its commands, and EXEC together: Shift+Enter between lines, or paste them.", kind: "err" });
    return done();
  }
  const risky = parsed.filter(isDangerous);
  if (risky.length) {
    const ok = await confirm({
      title: `Run ${[...new Set(risky.map((p) => p.name))].join(", ")}?`,
      message: `${risky.map((p) => p.line).join("\n").slice(0, 600)}\n\nThis changes ${connName(state.target)} and can't be undone.`,
      buttons: ["Run", "Cancel"],
      default: "Cancel",
      cancel: "Cancel",
    });
    if (ok !== "Run") return false;
  }
  const db = state.db;
  const target = state.target;
  const entries = parsed.map((p) => addEntry({ cmd: p.line, pending: true }));
  c.running = true;
  done();
  const t0 = performance.now();
  try {
    const replies = await call(target, parsed.map((p) => p.args), { db, timeoutMs: 60000, status: true });
    let cur = db;
    replies.forEach((r, i) => {
      Object.assign(entries[i], { prompt: promptText(cur), out: formatReply(r), kind: isErr(r) ? "err" : "ok", pending: false });
      if (parsed[i].name === "SELECT" && !isErr(r)) cur = Number(showText(parsed[i].args[1])) || 0;
    });
    entries[entries.length - 1].ms = Math.round(performance.now() - t0);
    if (cur !== db && state.target === target) selectDb(cur, { quiet: true });
    if (parsed.some((p) => !READONLY.has(p.name))) {
      loadKeys({ refresh: true, quiet: true });
      kickInfo();
    }
  } catch (e) {
    for (const en of entries) if (en.pending) Object.assign(en, { pending: false, out: `(error) ${e.message}`, kind: "err" });
    if (isConnError(e) && e.kind !== "timeout" && state.target === target) lostConnection(e);
  } finally {
    c.running = false;
  }
  return done();
}

function scrollConsole() {
  if (state.view !== "console") return;
  const el = $("#list");
  el.scrollTop = el.scrollHeight;
}

function historyStep(dir) {
  const c = state.console;
  const input = $("#console-in");
  const h = c.history;
  if (!h.length) return;
  if (c.hpos === -1) c.draft = input.value;
  c.hpos = Math.max(-1, Math.min(h.length - 1, c.hpos + dir));
  input.value = c.hpos === -1 ? c.draft : h[h.length - 1 - c.hpos];
  autosize(input);
  input.setSelectionRange(input.value.length, input.value.length);
}

function autosize(el) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

// ---------------------------------------------------------------- toasts and dialogs

function toast(text, { kind = "ok", timeout = 3200 } = {}) {
  const host = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === "error" ? "alert" : "check")}<span class="toast-text">${esc(text)}</span>`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add("out");
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener("click", close);
  host.append(el);
  while (host.children.length > 4) host.firstElementChild.remove();
  if (timeout) setTimeout(close, timeout);
}

function toastError(e, prefix = "") {
  const msg = e?.message || String(e);
  console.warn("[redis]", prefix ? `${prefix}: ${msg}` : msg);
  toast(prefix ? `${prefix}: ${msg}` : msg, { kind: "error", timeout: 8000 });
}

async function copyText(text, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      ta.remove();
    }
  }
  toast(what);
}

async function confirm(opts) {
  try {
    return await mx().dialog.confirm(opts);
  } catch (e) {
    toastError(e);
    return null;
  }
}

async function prompt(opts) {
  try {
    return await mx().dialog.prompt(opts);
  } catch (e) {
    toastError(e);
    return null;
  }
}

async function busy(key, label, fn) {
  if (state.busy.has(key)) return false;
  state.busy.set(key, label);
  renderBusy();
  try {
    await fn();
    return true;
  } catch (e) {
    if (!isConnError(e)) toastError(e);
    return false;
  } finally {
    state.busy.delete(key);
    renderBusy();
  }
}

function renderBusy() {
  renderToolbar();
  if (state.detail) renderDetailChrome();
}

// ---------------------------------------------------------------- menu

let menuItems = null;

function openMenu(items, anchor) {
  items = (items || []).filter(Boolean);
  if (!items.length) return;
  const el = $("#menu");
  menuItems = items;
  el.innerHTML = items
    .map((it, i) =>
      it === "-"
        ? '<div class="menu-sep"></div>'
        : `<button class="menu-item${it.danger ? " danger" : ""}" data-menu="${i}"${it.disabled ? " disabled" : ""}>${icon(it.icon || "")}<span>${esc(it.label)}</span>${it.hint ? `<span class="menu-hint">${esc(it.hint)}</span>` : ""}</button>`
    )
    .join("");
  el.hidden = false;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x;
  let y;
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    x = anchor.dataset.align === "left" ? r.left : r.right - w;
    y = r.bottom + 4;
    if (y + h > window.innerHeight - 6) y = r.top - h - 4;
  } else {
    x = anchor.x;
    y = anchor.y;
    if (y + h > window.innerHeight - 6) y = anchor.y - h;
  }
  el.style.left = `${Math.max(6, Math.min(x, window.innerWidth - w - 6))}px`;
  el.style.top = `${Math.max(6, Math.min(y, window.innerHeight - h - 6))}px`;
  el.tabIndex = -1;
  el.focus({ preventScroll: true });
}

function closeMenu() {
  const el = $("#menu");
  if (el.hidden) return;
  el.hidden = true;
  menuItems = null;
}

function appMenu() {
  const t = state.target;
  return [
    { label: "Connections…", icon: "plug", run: openConnections },
    { label: "New Connection…", icon: "plus", run: () => openConnForm() },
    "-",
    { label: "New Key…", icon: "key", run: () => openNewKey(), disabled: !isOk() },
    { label: "Open redis-cli in a Terminal", icon: "terminal", run: openCli, disabled: !t },
    t && t.kind !== "docker" ? { label: "Copy Connection URL", icon: "link", run: () => copyText(connUrl({ ...t, db: state.db }), "Copied the URL (without the password)") } : null,
    "-",
    { label: `Delete All Keys in db${state.db}…`, icon: "trash", danger: true, run: flushDb, disabled: !isOk() },
  ];
}

function dbMenu() {
  const ks = keyspace(state.info);
  const items = [];
  const count = Math.min(state.dbCount, 64);
  for (let i = 0; i < count; i++) {
    const keys = ks[i]?.keys || 0;
    if (count > 16 && !keys && i !== state.db && i !== 0) continue;
    items.push({ label: `db${i}`, hint: keys ? fmtNum(keys) : "", icon: i === state.db ? "check" : "", run: () => selectDb(i) });
  }
  return items;
}

function typeMenu() {
  const types = ["", "string", "hash", "list", "set", "zset", "stream", ...(hasJson() ? ["ReJSON-RL"] : [])];
  return types.map((t) => ({
    label: t ? typeInfo(t).label : "All types",
    icon: state.typeFilter === t ? "check" : "",
    run: () => {
      state.typeFilter = t;
      renderToolbar();
      loadKeys({ reset: true });
    },
  }));
}

function keyMenu(it) {
  return [
    { label: "Open", icon: "eye", run: () => openKey(it) },
    { label: "Copy Name", icon: "copy", run: () => copyText(it.name, "Copied the key name") },
    "-",
    { label: "Set Expiry…", icon: "clock", run: () => setTtl(it.key, it.name, it.expireAt) },
    { label: "Copy To…", icon: "layers", run: () => copyKeyTo(it.key, it.name) },
    "-",
    { label: "Delete…", icon: "trash", danger: true, run: () => deleteKey(it.key, it.name) },
  ];
}

function folderMenu(path) {
  const pattern = `${escapeGlob(path)}*`;
  return [
    {
      label: `Filter to ${path}*`,
      icon: "filter",
      run: () => {
        $("#filter").value = pattern;
        state.filter = pattern;
        syncClear();
        loadKeys({ reset: true });
      },
    },
    { label: "Copy Pattern", icon: "copy", run: () => copyText(pattern, "Copied the pattern") },
    { label: "New Key Here…", icon: "plus", run: () => openNewKey(path) },
    "-",
    { label: `Delete Keys Matching ${path}*…`, icon: "trash", danger: true, run: () => deleteMatching(pattern) },
  ];
}

function itemMenu(i) {
  const d = state.detail;
  const e = d?.data?.entries[i];
  if (!e) return [];
  const value = d.type === "hash" ? e[1] : d.type === "list" ? e[1] : e[0];
  const editable = ["hash", "list", "set", "zset"].includes(d.type) && !(value instanceof Uint8Array);
  return [
    d.type === "hash" ? { label: "Copy Field", icon: "copy", run: () => copyText(showText(e[0]), "Copied the field") } : null,
    d.type !== "stream" ? { label: "Copy Value", icon: "copy", run: () => copyText(showText(value), "Copied the value") } : { label: "Copy ID", icon: "copy", run: () => copyText(e[0], "Copied the ID") },
    editable ? { label: "Edit", icon: "pencil", run: () => startEditItem(i) } : null,
    "-",
    { label: "Remove…", icon: "trash", danger: true, run: () => deleteItem(i) },
  ];
}

function connMenu(id) {
  const c = connById(id);
  if (!c) return [];
  const saved = isSaved(c);
  return [
    { label: "Connect", icon: "plug", run: () => useConn(id), disabled: id === state.activeId && isOk() },
    saved ? { label: "Edit…", icon: "pencil", run: () => openConnForm(id) } : null,
    saved ? { label: "Duplicate…", icon: "copy", run: () => openConnForm(null, { ...c, id: null, name: `${connName(c)} copy` }) } : null,
    c.source === "env" ? { label: "Save as Connection…", icon: "save", run: () => saveAsConnection(id) } : null,
    c.kind !== "docker" ? { label: "Copy URL", icon: "link", run: () => copyText(connUrl(c), "Copied the URL (without the password)") } : null,
    saved ? "-" : null,
    saved ? { label: "Remove…", icon: "trash", danger: true, run: () => removeConn(id) } : null,
  ];
}

function menuFor(el) {
  const ctx = el.dataset.ctx;
  if (ctx === "key") {
    const it = state.keys.items[Number(el.dataset.k)];
    return it ? keyMenu(it) : [];
  }
  if (ctx === "folder") return folderMenu(el.dataset.path);
  if (ctx === "item") return itemMenu(Number(el.dataset.i));
  if (ctx === "conn") return connMenu(el.dataset.id);
  if (ctx === "key-detail") {
    const d = state.detail;
    return [
      { label: "Copy Name", icon: "copy", run: () => copyText(d.name, "Copied the key name") },
      { label: "Copy To…", icon: "layers", run: () => copyKeyTo(d.key, d.name) },
      d.type === "zset" ? { label: d.desc ? "Lowest Score First" : "Highest Score First", icon: "up", run: () => ((d.desc = !d.desc), loadKeyDetail()) } : null,
      "-",
      { label: "Delete…", icon: "trash", danger: true, run: () => deleteKey(d.key, d.name) },
    ];
  }
  return [];
}

// ---------------------------------------------------------------- views

function setView(v) {
  if (!VIEWS.some((x) => x.id === v) || v === state.view) return;
  if (state.detail && state.detail.kind !== "connections" && state.detail.kind !== "conn-form") closeDetail();
  state.view = v;
  savePrefs();
  closeMenu();
  $("#list").scrollTop = 0;
  renderAll();
  if (v === "server") {
    runTask("info");
    runTask("server");
  }
  if (v === "console") {
    scrollConsole();
    setTimeout(() => $("#console-in").focus({ preventScroll: true }), 0);
  }
}

function renderAll() {
  document.body.classList.toggle("connected", isOk());
  for (const v of VIEWS) document.body.classList.toggle(`view-${v.id}`, state.view === v.id);
  renderHeader();
  renderTabs();
  renderToolbar();
  renderList();
  renderFooter();
  $("#console-prompt").textContent = promptText(state.db);
  if (state.detail) renderDetail();
}

function setHtml(el, html) {
  if (el._html === html) return false;
  el.innerHTML = html;
  el._html = html;
  return true;
}

function renderHeader() {
  const pill = $("#conn-pill");
  const s = state.conn.status;
  const c = connById(state.activeId);
  const tone = s === "ok" ? "ok" : s === "connecting" || s === "idle" ? "pending" : "bad";
  const name = c ? connName(c) : "No connection";
  pill.className = `engine-pill ${tone}`;
  pill.querySelector(".engine-text").textContent = s === "ok" && state.conn.version ? `${name} · ${state.conn.version}` : name;
  pill.title = s === "ok" ? `${state.conn.server} ${state.conn.version} at ${c ? connSub(c) : ""}. Click to switch.` : "Switch connection";
}

function renderTabs() {
  const n = keyspace(state.info)[state.db]?.keys;
  const html = VIEWS.map((v) => {
    const count = v.id === "keys" && n ? `<span class="tab-count">${fmtNum(n)}</span>` : "";
    return `<button class="tab${state.view === v.id ? " active" : ""}" role="tab" aria-selected="${state.view === v.id}" data-action="tab" data-view="${v.id}"><span class="tab-label">${v.label}</span>${count}</button>`;
  }).join("");
  setHtml($("#tabs"), html);
}

function renderToolbar() {
  const v = state.view;
  let title = "";
  let actions = "";
  if (v === "keys") {
    const k = state.keys;
    const t = state.typeFilter;
    actions =
      (k.loading ? spinner("Loading keys") : "") +
      `<button class="chip${t ? " on" : ""}" data-action="type-menu" data-align="right" title="Show one type of key">${esc(t ? typeInfo(t).label : "Type")}</button>` +
      btn(state.tree ? "list" : "list-tree", "toggle-tree", state.tree ? "Show as a flat list" : `Group by “${SEP}”`) +
      btn("plus", "new-key", "New key…", {}, { disabled: !isOk() });
  } else if (v === "console") {
    title = `<span class="muted">${esc(connName(connById(state.activeId)))} · db${state.db}</span>`;
    actions = btn("terminal", "open-cli", "Open redis-cli in a Terminal", {}, { disabled: !state.target }) + btn("eraser", "console-clear", "Clear");
  } else {
    const live = isOk() ? `<span class="live"><span class="pulse"></span>Live</span>` : "";
    title = `${live}<span class="muted">${esc(state.conn.server)} ${esc(state.conn.version)}${state.conn.role ? ` · ${esc(state.conn.role)}` : ""}</span>`;
    const saving = state.busy.get("bgsave");
    actions = saving ? spinner(saving) : btn("save", "bgsave", "Save a snapshot now (BGSAVE)", {}, { disabled: !isOk() });
  }
  setHtml($("#toolbar-title"), title);
  setHtml($("#toolbar-actions"), actions);
}

function renderList() {
  const el = $("#list");
  let html;
  if (!isOk()) html = connHtml();
  else if (state.view === "keys") html = keysHtml();
  else if (state.view === "console") html = consoleHtml();
  else html = serverHtml();
  const changed = setHtml(el, html);
  if (changed) {
    const auto = el.querySelector("[data-autofocus]");
    if (auto && !el.contains(document.activeElement)) setTimeout(() => auto.focus({ preventScroll: true }), 0);
  }
  applyTtls();
}

function stateScreen({ ic, spin, title, text, detail, buttons = [], extra = "" }) {
  return `<div class="state">
    <div class="state-icon">${spin ? '<span class="spin big"></span>' : icon(ic)}</div>
    <div class="state-title">${esc(title)}</div>
    ${text ? `<div class="state-text">${esc(text)}</div>` : ""}
    ${detail ? `<div class="state-detail">${esc(detail)}</div>` : ""}
    ${extra}
    ${buttons.length ? `<div class="state-buttons">${buttons.map((b) => `<button class="button${b.primary ? " primary" : ""}" data-action="${b.action}">${esc(b.label)}</button>`).join("")}</div>` : ""}
  </div>`;
}

function connHtml() {
  const s = state.conn.status;
  const c = connById(state.activeId);
  const name = connName(c);
  if (s === "none") {
    return stateScreen({
      ic: "plug",
      title: "No connection",
      text: "Add a Redis server, or pick one running in Docker or set in this project's .env.",
      buttons: [{ action: "conn-new", label: "New Connection", primary: true }, { action: "connections", label: "Connections" }],
    });
  }
  if (s === "connecting" || s === "idle") {
    return stateScreen({
      spin: true,
      title: `Connecting to ${name}…`,
      text: "If Muxy asks to run a command for this extension, choose Allow & Remember. The sidebar connects through it every time.",
    });
  }
  if (s === "auth") {
    const wrong = state.conn.kind === "auth";
    const savedUser = c?.username || state.passwords[state.activeId]?.username || "";
    return stateScreen({
      ic: "lock",
      title: wrong ? "Wrong password" : "Password needed",
      text: wrong ? `${name} didn't accept the user name or password.` : `${name} asks for a password.`,
      extra: `<div class="auth-form" data-form="auth">
        <input class="input" name="password" type="password" placeholder="Password" autocomplete="off" data-autofocus>
        <input class="input" name="username" type="text" placeholder="User (optional)" value="${esc(savedUser)}" autocomplete="off" spellcheck="false">
        <label class="check"><input type="checkbox" name="remember" checked><span>Remember it</span></label>
        <button class="button primary" data-action="auth-submit">Connect</button>
      </div>`,
      buttons: [{ action: "connections", label: "Other Connections" }],
    });
  }
  const kind = state.conn.kind;
  const suggestions = dockerSuggestions();
  if (state.conn.denied || kind === "exec") {
    return stateScreen({
      ic: "lock",
      title: "Muxy needs your permission",
      text: "The sidebar reaches Redis through a short shell command (nc, or docker for containers). Allow it when Muxy asks, then try again.",
      detail: state.conn.message,
      buttons: [{ action: "retry", label: "Try Again", primary: true }, { action: "connections", label: "Connections" }],
    });
  }
  if (kind === "missing") {
    return stateScreen({ ic: "alert", title: "A program is missing", text: state.conn.message, buttons: [{ action: "retry", label: "Try Again", primary: true }] });
  }
  const titles = { refused: `Can't reach ${name}`, docker: `Can't use ${name}`, timeout: `${name} isn't answering`, dns: "Unknown host", tls: "TLS problem", denied: `${name} refused the connection`, gone: "That connection is gone" };
  const texts = {
    refused: "Start Redis, or pick another connection. The sidebar keeps trying.",
    docker: "Start the container, or pick another connection. The sidebar keeps trying.",
    timeout: "The sidebar keeps trying.",
    denied: "Redis sent this reason:",
  };
  return stateScreen({
    ic: kind === "docker" ? "box" : "power",
    title: titles[kind] || `Couldn't connect to ${name}`,
    text: texts[kind] || "",
    detail: state.conn.message,
    buttons: [{ action: "retry", label: "Retry", primary: true }, { action: "connections", label: "Connections" }],
    extra: suggestions,
  });
}

// Redis containers to offer when the current connection doesn't work.
function dockerSuggestions() {
  const list = state.docker.containers.filter((d) => `docker:${d.name}` !== state.activeId).slice(0, 5);
  if (!list.length) return "";
  return `<div class="suggest"><div class="section-label">Redis in Docker</div>${list
    .map((d) => connRow(dockerConn(d.name)))
    .join("")}</div>`;
}

const loadingHtml = (text = "Loading…") => `<div class="loading"><span class="spin"></span>${esc(text)}</div>`;

function errorHtml(msg, action = "refresh") {
  return `<div class="inline-error">${icon("alert")}<div><div>${esc(msg)}</div><button class="link" data-action="${action}">Try again</button></div></div>`;
}

function emptyHtml(ic, title, text, extra = "") {
  return `<div class="empty">${icon(ic)}<div class="empty-title">${esc(title)}</div>${text ? `<div class="empty-text">${esc(text)}</div>` : ""}${extra}</div>`;
}

// ----- keys

function keysHtml() {
  const k = state.keys;
  if (k.error && !k.items.length) return errorHtml(k.error);
  if (!k.items.length) {
    if (!k.loaded || k.loading) return loadingHtml(state.filter || state.typeFilter ? "Searching…" : "Loading keys…");
    if (state.filter || state.typeFilter) {
      return emptyHtml("search", "No matching keys", `Nothing in db${state.db} matches ${matchPattern()}${state.typeFilter ? ` with type ${typeInfo(state.typeFilter).label}` : ""}.`);
    }
    return emptyHtml("key", `db${state.db} is empty`, "Add a key here, or with SET in the console.", `<div class="state-buttons"><button class="button primary" data-action="new-key">New Key</button></div>`);
  }
  const rows = [];
  const open = (node) => state.expanded.has(node.path) || (!!state.filter && k.items.length <= 300);
  const walk = (node, depth) => {
    const folders = [...node.folders.values()].sort((a, b) => cmp(a.name, b.name));
    for (const f of folders) {
      if (rows.length >= MAX_ROWS) return;
      const isOpen = open(f);
      rows.push(folderRow(f, depth, isOpen));
      if (isOpen) walk(f, depth + 1);
    }
    for (const { it, label } of node.leaves) {
      if (rows.length >= MAX_ROWS) return;
      rows.push(keyRow(it, label, depth));
    }
  };
  if (state.tree) walk(buildTree(k.items), 0);
  else for (const it of k.items.slice(0, MAX_ROWS)) rows.push(keyRow(it, it.name, 0));
  let html = (k.error ? errorHtml(k.error) : "") + `<div class="keys">${rows.join("")}</div>`;
  if (rows.length >= MAX_ROWS) html += `<div class="list-note">Showing the first ${fmtNum(MAX_ROWS)} rows. Filter to narrow it down.</div>`;
  if (!k.done) {
    html += `<div class="more-row">${
      k.loading ? `<span class="spin"></span><span class="muted">Scanning…</span>` : `<button class="link" data-action="load-more">Load more keys</button><span class="muted">${fmtNum(k.items.length)} loaded</span>`
    }</div>`;
  }
  return html;
}

function folderRow(node, depth, open) {
  return `<div class="row key-row folder-row${open ? " open" : ""}" data-action="folder" data-path="${esc(node.path)}" data-ctx="folder" tabindex="0" style="--depth:${depth}">
    <span class="chev">${icon("chevron")}</span>${icon(open ? "folder-open" : "folder", "folder-icon")}<span class="name">${esc(node.name || "(empty)")}</span><span class="count">${fmtNum(node.count)}</span></div>`;
}

function keyRow(it, label, depth) {
  const active = state.detail?.kind === "key" && state.detail.id === it.id;
  return `<div class="row key-row${active ? " active" : ""}" data-action="open-key" data-k="${it.idx}" data-ctx="key" tabindex="0" style="--depth:${depth}" title="${esc(it.name)}">${typeTag(it.type)}<span class="name">${esc(label === "" ? it.name : label)}</span>${
    it.expireAt ? `<span class="ttl" data-exp="${it.expireAt}"></span>` : ""
  }</div>`;
}

function applyTtls() {
  const now = Date.now();
  for (const el of document.querySelectorAll("[data-exp]")) {
    const left = Number(el.dataset.exp) - now;
    const text = fmtTtl(left);
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle("soon", left > 0 && left < 60000);
    el.classList.toggle("gone", left <= 0);
  }
  for (const el of document.querySelectorAll("[data-exp-long]")) {
    const left = Number(el.dataset.expLong) - now;
    const text = left > 0 ? fmtDuration(left / 1000) : "expired";
    if (el.textContent !== text) el.textContent = text;
  }
}

// ----- console

function consoleHtml() {
  const c = state.console;
  if (!c.entries.length) {
    return `<div class="console-empty"><div class="empty-title">Console</div><div class="empty-text">Run commands on db${state.db} of ${esc(connName(state.target))}. Type <code>help</code> for tips.</div>${
      c.history.length ? `<div class="console-recent"><div class="section-label">Recent</div>${[...c.history].reverse().slice(0, 6).map((h, i) => `<button class="recent" data-action="console-recent" data-i="${c.history.length - 1 - i}">${esc(h.split("\n")[0].slice(0, 80))}</button>`).join("")}</div>` : ""
    }</div>`;
  }
  return `<div class="console-log">${c.entries
    .map(
      (e) => `<div class="c-entry">
        <div class="c-cmd"><span class="c-prompt">${esc(e.prompt)}</span><span class="c-text">${esc(e.cmd)}</span>${e.ms != null ? `<span class="c-ms">${e.ms} ms</span>` : ""}</div>
        ${e.pending ? `<div class="c-out pending"><span class="spin tiny"></span></div>` : e.out != null ? `<pre class="c-out ${e.kind}">${esc(e.out)}</pre>` : ""}
      </div>`
    )
    .join("")}</div>`;
}

// ----- server

function spark(values) {
  if (values.length < 2) return `<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none"></svg>`;
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const span = hi - lo || 1;
  const step = 100 / 59;
  const pts = values.map((v, i) => [100 - (values.length - 1 - i) * step, hi === lo ? 12 : 22 - ((v - lo) / span) * 20]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pts[0][0].toFixed(1)},24 ${line} 100,24`;
  return `<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none"><polygon points="${area}" class="spark-area"/><polyline points="${line}" class="spark-line" vector-effect="non-scaling-stroke"/></svg>`;
}

function tile(label, value, sub = "", chart = "") {
  return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div>${sub ? `<div class="tile-sub">${esc(sub)}</div>` : ""}${chart}</div>`;
}

function kv(label, value, { mono = false, copy = null } = {}) {
  if (value == null || value === "") return "";
  return `<div class="kv"><div class="k">${esc(label)}</div><div class="v${mono ? " mono" : ""}">${esc(value)}${
    copy ? `<button class="mini-copy" data-action="copy" data-copy="${esc(copy)}" title="Copy">${icon("copy")}</button>` : ""
  }</div></div>`;
}

function section(title, body, extra = "") {
  if (!body) return "";
  return `<section class="d-section"><h3><span>${esc(title)}</span>${extra}</h3>${body}</section>`;
}

const fmtKbps = (k) => (k >= 1024 ? `${(k / 1024).toFixed(1)} MB/s` : `${(+k).toFixed(k < 10 ? 2 : 0)} KB/s`);

function serverHtml() {
  const i = state.info;
  if (!i) return loadingHtml("Loading server info…");
  const S = state.samples;
  const hits = +i.keyspace_hits || 0;
  const misses = +i.keyspace_misses || 0;
  const ks = keyspace(i);
  const total = Object.values(ks).reduce((a, d) => a + (d.keys || 0), 0);
  const max = +i.maxmemory || 0;
  const used = +i.used_memory || 0;
  const tiles = [
    tile("Ops/sec", fmtNum(+i.instantaneous_ops_per_sec || 0), `${fmtNum(+i.total_commands_processed || 0)} total`, spark(S.map((s) => s.ops))),
    tile("Memory", formatBytes(used), max ? `${Math.round((used / max) * 100)}% of ${formatBytes(max)}` : `peak ${formatBytes(+i.used_memory_peak || 0)}`, spark(S.map((s) => s.mem))),
    tile("Clients", fmtNum(+i.connected_clients || 0), +i.blocked_clients ? `${fmtNum(+i.blocked_clients)} blocked` : "connected", spark(S.map((s) => s.clients))),
    tile("Network", fmtKbps((+i.instantaneous_input_kbps || 0) + (+i.instantaneous_output_kbps || 0)), `${fmtKbps(+i.instantaneous_input_kbps || 0)} in`, spark(S.map((s) => s.net))),
    tile("Hit rate", hits + misses ? `${((hits / (hits + misses)) * 100).toFixed(1)}%` : "—", `${fmtNum(hits)} hits · ${fmtNum(misses)} misses`),
    tile("Keys", fmtNum(total), `${fmtNum(+i.expired_keys || 0)} expired · ${fmtNum(+i.evicted_keys || 0)} evicted`),
  ];
  let html = `<div class="tiles">${tiles.join("")}</div>`;

  const dbRows = Object.entries(ks)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(
      ([db, d]) => `<div class="row mini-row${Number(db) === state.db ? " active" : ""}" data-action="select-db" data-db="${db}" tabindex="0">
        <span class="db-name mono">db${db}</span><span class="sub">${plural(d.keys || 0, "key")}${d.expires ? ` · ${fmtNum(d.expires)} with TTL` : ""}${d.avg_ttl ? ` · avg TTL ${fmtDuration(d.avg_ttl / 1000)}` : ""}</span>
        ${Number(db) === state.db ? `<span class="badge ok">In use</span>` : ""}</div>`
    )
    .join("");
  html += section("Keyspace", dbRows || `<div class="muted small">No keys in any database.</div>`);

  html += section(
    "Server",
    kv(state.conn.server, state.conn.version) +
      kv("Mode", i.redis_mode || i.server_mode) +
      kv("Role", i.role) +
      kv("Uptime", i.uptime_in_seconds ? fmtDuration(+i.uptime_in_seconds) : "") +
      kv("Port", i.tcp_port) +
      kv("OS", i.os) +
      kv("Config file", i.config_file || "none", { mono: true }) +
      kv("Executable", i.executable, { mono: true })
  );

  html += section(
    "Memory",
    kv("Used", i.used_memory_human || formatBytes(used)) +
      kv("Resident", i.used_memory_rss_human) +
      kv("Peak", i.used_memory_peak_human) +
      kv("Fragmentation", i.mem_fragmentation_ratio) +
      kv("Limit", max ? i.maxmemory_human : "No limit") +
      kv("Eviction", i.maxmemory_policy)
  );

  const rdbAt = +i.rdb_last_save_time;
  html += section(
    "Persistence",
    kv("Last snapshot", rdbAt ? `${ago(rdbAt)} (${new Date(rdbAt * 1000).toLocaleString()})` : "never") +
      kv("Changes since", i.rdb_changes_since_last_save) +
      kv("Snapshot status", i.rdb_bgsave_in_progress === "1" ? "saving now…" : i.rdb_last_bgsave_status) +
      kv("Append-only file", i.aof_enabled === "1" ? `on · ${i.aof_last_write_status || "ok"}` : "off")
  );

  if (i.role === "master" && +i.connected_slaves) {
    const reps = Object.entries(i)
      .filter(([k]) => /^slave\d+$/.test(k))
      .map(([, v]) => {
        const f = parseFields(v);
        return kv(`${f.ip}:${f.port}`, `${f.state} · lag ${f.lag}s`);
      })
      .join("");
    html += section("Replicas", reps);
  } else if (i.role === "slave") {
    html += section("Replication", kv("Primary", `${i.master_host}:${i.master_port}`) + kv("Link", i.master_link_status) + kv("Last contact", i.master_last_io_seconds_ago != null ? `${i.master_last_io_seconds_ago}s ago` : ""));
  }

  const cs = state.server.cmdstats;
  if (cs?.length) {
    const top = cs.slice(0, 8);
    const most = top[0].calls || 1;
    html += section(
      "Top commands",
      top
        .map(
          (c) => `<div class="bar-row" title="${esc(`${fmtNum(c.calls)} calls, ${c.per} µs each${c.failed ? `, ${fmtNum(c.failed)} failed` : ""}`)}">
            <span class="bar-name mono">${esc(c.name)}</span><span class="bar"><span style="width:${Math.max(2, (c.calls / most) * 100)}%"></span></span><span class="bar-val">${fmtNum(c.calls)}</span></div>`
        )
        .join("")
    );
  }

  const cl = state.server.clients;
  if (cl) {
    const body = cl.error
      ? `<div class="muted small">${esc(cl.error)}</div>`
      : cl.length
      ? cl
          .slice(0, 40)
          .map(
            (c) => `<div class="row mini-row client-row">
              ${icon("users", "row-glyph")}
              <div class="row-main"><div class="line1"><span class="name mono">${esc(c.name || c.addr)}</span></div>
              <div class="line2"><span class="sub">${esc([c.name ? c.addr : "", `db${c.db}`, `idle ${fmtDuration(+c.idle || 0)}`, `up ${fmtDuration(+c.age || 0)}`, c.cmd && c.cmd !== "NULL" ? `last ${c.cmd.replace("|", " ")}` : ""].filter(Boolean).join(" · "))}</span></div></div>
              <div class="row-actions">${btn("x", "client-kill", "Disconnect this client…", { id: c.id, addr: c.addr })}</div></div>`
          )
          .join("") + (cl.length > 40 ? `<div class="muted small">and ${fmtNum(cl.length - 40)} more</div>` : "")
      : `<div class="muted small">Only this sidebar is connected.</div>`;
    html += section(`Clients${Array.isArray(cl) ? ` · ${cl.length}` : ""}`, body);
  }

  const sl = state.server.slowlog;
  if (sl) {
    const body = sl.error
      ? `<div class="muted small">${esc(sl.error)}</div>`
      : sl.length
      ? sl
          .map(
            (e) => `<div class="slow-row" title="${esc(e.args.join(" "))}">
              <div class="slow-cmd mono">${esc(e.args.join(" ").slice(0, 160))}</div>
              <div class="sub">${(e.us / 1000).toFixed(e.us < 10000 ? 2 : 0)} ms · ${esc(ago(e.at))}${e.client ? ` · ${esc(e.client)}` : ""}</div></div>`
          )
          .join("")
      : `<div class="muted small">Nothing slower than ${esc(i.slowlog_log_slower_than ? `${i.slowlog_log_slower_than} µs` : "the threshold")} yet.</div>`;
    html += section("Slow log", body, Array.isArray(sl) && sl.length ? `<button class="link small" data-action="slowlog-reset">Clear</button>` : "");
  }
  return html;
}

// ----- footer

function renderFooter() {
  const el = $("#footer");
  if (!isOk() || !state.info) {
    setHtml(el, "");
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const cur = keyspace(state.info)[state.db] || { keys: 0, expires: 0 };
  const used = +state.info.used_memory || 0;
  const max = +state.info.maxmemory || 0;
  const pct = max ? Math.min(100, (used / max) * 100) : 0;
  setHtml(
    el,
    `<button class="db-btn" data-action="db-menu" data-align="left" title="Switch database">${icon("database")}<span>db${state.db}</span>${icon("chevron-down", "caret")}</button>
    <div class="footer-stat"><span class="fs-main">${plural(cur.keys || 0, "key")}</span>${cur.expires ? `<span class="fs-sub">${fmtNum(cur.expires)} with TTL</span>` : ""}</div>
    <div class="mem" title="${esc(`${formatBytes(used)} used${max ? ` of ${formatBytes(max)}` : ", no limit set"}`)}">
      <div class="mem-text">${esc(formatBytes(used))}${max ? `<span class="fs-sub"> / ${esc(formatBytes(max))}</span>` : ""}</div>
      ${max ? `<div class="disk-bar"><span style="width:${pct.toFixed(1)}%"></span></div>` : ""}
    </div>`
  );
}

// ---------------------------------------------------------------- detail

function showDetail() {
  const el = $("#detail");
  el.innerHTML = `<div id="d-chrome"></div><div id="d-filter"></div><div class="d-body" id="d-body"></div>`;
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
  renderDetail({ force: true });
}

function closeDetail() {
  const d = state.detail;
  state.detail = null;
  const el = $("#detail");
  el.classList.remove("open");
  el.setAttribute("aria-hidden", "true");
  if (d?.kind === "key") renderList();
}

// Back from a detail: the form returns to the list it came from.
function leaveDetail() {
  const d = state.detail;
  if (!d) return;
  if (d.kind === "key" && (d.editing || d.adding)) return cancelEdit();
  if (d.kind === "key" && d.renaming) {
    d.renaming = false;
    return renderDetailChrome();
  }
  if (d.kind === "conn-form" && d.back === "connections") return openConnections();
  closeDetail();
}

function renderDetail({ force = false } = {}) {
  renderDetailChrome();
  renderDetailFilter();
  renderDetailBody({ force });
}

function renderDetailChrome() {
  const d = state.detail;
  const host = $("#d-chrome");
  if (!d || !host) return;
  let html = "";
  if (d.kind === "key") html = keyChromeHtml(d);
  else if (d.kind === "connections") html = simpleHead("Connections", connName(connById(state.activeId)), btn("plus", "conn-new", "New connection…"));
  else if (d.kind === "conn-form") html = simpleHead(d.id ? "Edit Connection" : "New Connection", d.id ? connName(d.draft) : "Redis, Valkey, or anything that speaks RESP");
  else if (d.kind === "new-key") html = simpleHead("New Key", `in db${state.db} on ${connName(state.target)}`);
  const changed = setHtml(host, html);
  if (changed && d.renaming) {
    const input = $("#rename-in");
    input?.focus({ preventScroll: true });
    input?.select();
  }
  applyTtls();
}

function simpleHead(title, sub, extra = "") {
  return `<div class="d-head">${btn("back", "d-back", "Back")}<div class="d-title"><div class="d-name">${esc(title)}</div>${sub ? `<div class="d-sub">${esc(sub)}</div>` : ""}</div>${extra}</div>`;
}

function sizeText(type, n) {
  if (n == null || typeof n !== "number") return "";
  return {
    string: formatBytes(n),
    hash: plural(n, "field"),
    list: plural(n, "item"),
    set: plural(n, "member"),
    zset: plural(n, "member"),
    stream: plural(n, "entry", "entries"),
  }[type] || "";
}

function keyChromeHtml(d) {
  const data = d.data;
  const parts = [d.expireAt ? `TTL <span data-exp-long="${d.expireAt}"></span>` : "No expiry"];
  if (data && typeof data.length === "number") parts.push(esc(d.type === "string" ? `${formatBytes(data.length)} value` : sizeText(d.type, data.length)));
  if (d.memory != null) parts.push(`${esc(formatBytes(d.memory))} in memory`);
  if (d.encoding) parts.push(esc(d.encoding));
  const busyLabel = state.busy.get("key");
  const addLabel = { hash: "Add Field", list: "Push", set: "Add", zset: "Add", stream: "Add Entry" }[d.type];
  const binary = data?.value instanceof Uint8Array;
  const canEdit = (d.type === "string" && data && !binary && !data.truncated) || (d.type === "ReJSON-RL" && data && !data.error);
  const actions = d.gone
    ? ""
    : busyLabel
    ? `<div class="busy-row"><span class="spin"></span>${esc(busyLabel)}…</div>`
    : [
        addLabel ? abtn("plus", "k-add", addLabel, { disabled: !data }) : d.type === "string" || d.type === "ReJSON-RL" ? abtn("pencil", "k-edit", "Edit", { disabled: !canEdit }) : "",
        abtn("clock", "k-ttl", "Expiry"),
        abtn("tag", "k-rename", "Rename", { disabled: d.key instanceof Uint8Array }),
        abtn("copy", "k-copy", "Copy", { title: "Copy the key name" }),
        abtn("trash", "k-delete", "Delete", { cls: "danger" }),
      ].join("");
  const name = d.renaming
    ? `<input class="input rename-input mono" id="rename-in" value="${esc(d.name)}" spellcheck="false" autocomplete="off">`
    : `<div class="d-name" title="${esc(d.name)}"><span class="d-name-text">${esc(d.name)}</span></div>`;
  return `<div class="d-head">
      ${btn("back", "d-back", "Back")}
      ${typeTag(d.type)}
      <div class="d-title">${name}<div class="d-sub">${d.gone ? "Deleted or expired" : parts.join(" · ")}</div></div>
      ${d.gone ? "" : btn("refresh", "k-refresh", "Reload")}
      ${d.gone ? "" : btn("more", "menu", "More", { ctx: "key-detail" })}
    </div>
    ${actions ? `<div class="d-actions">${actions}</div>` : ""}`;
}

const COLLECTION_LABEL = { hash: "Filter fields", set: "Filter members", zset: "Filter members", list: "Filter items", stream: "Filter entries" };

// A filter box for long collections. Drawn once per type so typing in it
// isn't interrupted by refreshes.
function renderDetailFilter() {
  const d = state.detail;
  const host = $("#d-filter");
  if (!host) return;
  const want = d?.kind === "key" && d.data && COLLECTION_LABEL[d.data.kind] && (d.data.length || 0) > 8 ? d.data.kind : "";
  if (host._kind === want) return;
  host._kind = want;
  host.innerHTML = want
    ? `<label class="search d-search">${icon("search")}<input id="d-q" type="text" placeholder="${COLLECTION_LABEL[want]}" spellcheck="false" autocomplete="off" value="${esc(d.q)}"></label>`
    : "";
}

function renderDetailBody({ force = false } = {}) {
  const d = state.detail;
  const body = $("#d-body");
  if (!d || !body) return;
  if (!force && body.querySelector("[data-form]") && (d.kind === "conn-form" || d.kind === "new-key" || d.editing || d.adding)) return;
  if (!force && hasSelectionIn(body)) return;
  let html;
  if (d.kind === "key") html = keyBodyHtml(d);
  else if (d.kind === "connections") html = connectionsHtml();
  else if (d.kind === "conn-form") html = connFormHtml(d);
  else html = newKeyHtml(d);
  if (body._html === html) return;
  body.innerHTML = html;
  body._html = html;
  const auto = body.querySelector("[data-autofocus]");
  if (auto) {
    auto.focus({ preventScroll: true });
    if (auto.tagName === "TEXTAREA") auto.setSelectionRange(0, 0);
  }
  for (const ta of body.querySelectorAll("textarea.grow")) autosize(ta);
}

// ----- key body

function keyBodyHtml(d) {
  if (d.gone) {
    return emptyHtml("key", "This key is gone", "It expired or was deleted.", `<div class="state-buttons"><button class="button" data-action="d-back">Back to Keys</button></div>`);
  }
  if (d.error && !d.data) return errorHtml(d.error, "k-refresh");
  if (!d.data) return loadingHtml("Loading…");
  const data = d.data;
  let html = d.error ? errorHtml(d.error, "k-refresh") : "";
  if (d.adding) html += addFormHtml(d);
  switch (data.kind) {
    case "string":
      html += stringHtml(d, data);
      break;
    case "json":
      html += jsonHtml(d, data);
      break;
    case "hash":
    case "set":
    case "list":
    case "zset":
      html += itemsHtml(d, data);
      break;
    case "stream":
      html += streamHtml(d, data);
      break;
    default:
      html += `<div class="list-note">The sidebar can't show ${esc(typeInfo(d.type).label)} values yet. Try the console, for example <code>TYPE</code> and <code>MEMORY USAGE</code>.</div>`;
  }
  return html;
}

const FORMATS = [
  ["auto", "Auto"],
  ["text", "Text"],
  ["json", "JSON"],
  ["hex", "Hex"],
];

function valueHtml(v, format = "auto") {
  if (v == null) return `<div class="value nil">(nil)</div>`;
  const bin = v instanceof Uint8Array;
  if (format === "hex") return `<pre class="value hex">${esc(hexDump(bin ? v : enc.encode(String(v))))}</pre>`;
  if (bin) return `<pre class="value binary">${esc(escapeBinary(v))}</pre><div class="value-note">Binary, ${plural(v.length, "byte")}, shown with \\x escapes.</div>`;
  const s = String(v);
  if (format === "json" || (format === "auto" && looksJson(s))) {
    const pretty = prettyJson(s, { html: true });
    if (pretty != null) return `<pre class="value json">${pretty}</pre>`;
    if (format === "json") return `<div class="value-note bad">This isn't valid JSON.</div><pre class="value">${esc(s)}</pre>`;
  }
  if (s === "") return `<div class="value nil">(empty string)</div>`;
  return `<pre class="value">${esc(s)}</pre>`;
}

function stringHtml(d, data) {
  if (d.editing) {
    return `<div class="edit-form" data-form="value">
      <textarea class="input mono value-edit" name="value" spellcheck="false" data-autofocus>${esc(d.editing.text)}</textarea>
      <div class="form-actions"><span class="muted small">⌘↩ to save · Esc to cancel</span><span class="spacer"></span><button class="button" data-action="edit-cancel">Cancel</button><button class="button primary" data-action="value-save">Save</button></div>
    </div>`;
  }
  const bar = `<div class="value-bar"><div class="seg">${FORMATS.map(([f, label]) => `<button class="seg-btn${d.format === f ? " on" : ""}" data-action="k-format" data-format="${f}">${label}</button>`).join("")}</div>
    <span class="spacer"></span>${btn("copy", "k-copy-value", "Copy value")}</div>`;
  const note = data.truncated ? `<div class="value-note">Showing the first ${formatBytes(MAX_STRING)} of ${formatBytes(data.length)}.</div>` : "";
  return `${bar}${note}<div class="value-wrap">${valueHtml(data.value, d.format)}</div>`;
}

function jsonHtml(d, data) {
  if (data.error) return errorHtml(data.error, "k-refresh");
  if (d.editing) return stringHtml(d, data);
  return `<div class="value-bar"><span class="muted small">JSON document</span><span class="spacer"></span>${btn("copy", "k-copy-value", "Copy value")}</div><div class="value-wrap">${valueHtml(data.value, "json")}</div>`;
}

function entryMatches(d, e) {
  const qt = d.q.trim().toLowerCase();
  if (!qt) return true;
  if (d.type === "stream") return e[0].includes(qt) || e[1].some((x) => showText(x).toLowerCase().includes(qt));
  return e.some((x) => showText(x).toLowerCase().includes(qt));
}

function itemsHtml(d, data) {
  if (!data.entries.length) return emptyHtml("list", "Empty", `This ${typeInfo(d.type).label.toLowerCase()} has nothing in it.`);
  const cols = { hash: ["Field", "Value"], list: ["#", "Value"], set: ["", "Member"], zset: ["Member", "Score"] }[d.type];
  const rows = [];
  data.entries.forEach((e, i) => {
    if (rows.length < 2000 && entryMatches(d, e)) rows.push(itemHtml(d, e, i));
  });
  let html = `<div class="items items-${d.type}"><div class="items-head"><span>${cols[0]}</span><span>${cols[1]}</span>${d.type === "zset" ? `<button class="link small" data-action="zset-order">${d.desc ? "Highest first" : "Lowest first"}</button>` : ""}</div>${
    rows.join("") || `<div class="muted small pad">Nothing matches “${esc(d.q)}”.</div>`
  }</div>`;
  if (!data.done) {
    html += `<div class="more-row">${d.loadingMore ? `<span class="spin"></span>` : `<button class="link" data-action="k-more">Load more</button>`}<span class="muted">${fmtNum(data.entries.length)} of ${fmtNum(data.length)}</span></div>`;
  }
  return html;
}

function itemHtml(d, e, i) {
  const open = d.open.has(i);
  let k = "";
  let v;
  let right = "";
  if (d.type === "hash") {
    k = showText(e[0]);
    v = e[1];
  } else if (d.type === "list") {
    k = String(e[0]);
    v = e[1];
  } else if (d.type === "set") {
    v = e[0];
  } else {
    v = e[0];
    right = e[1];
  }
  const head = `<div class="item-head" data-action="item" data-i="${i}" data-ctx="item" tabindex="0">
      ${d.type === "set" ? "" : d.type === "zset" ? "" : `<span class="item-k${d.type === "list" ? " idx" : ""}" title="${esc(k)}">${esc(k)}</span>`}
      <span class="item-v">${esc(preview(v))}</span>
      ${d.type === "zset" ? `<span class="item-score">${esc(right)}</span>` : ""}
    </div>`;
  if (!open) return `<div class="item">${head}</div>`;
  if (d.editing && d.editing.i === i) return `<div class="item open">${head}${itemEditHtml(d, e, i)}</div>`;
  const editable = !(v instanceof Uint8Array);
  return `<div class="item open">${head}<div class="item-body">${valueHtml(v)}
    <div class="item-actions">
      <button class="text-btn" data-action="item-copy" data-i="${i}">${icon("copy")}<span>Copy</span></button>
      ${editable ? `<button class="text-btn" data-action="item-edit" data-i="${i}">${icon("pencil")}<span>Edit</span></button>` : ""}
      <button class="text-btn danger" data-action="item-delete" data-i="${i}">${icon("trash")}<span>Remove</span></button>
    </div></div></div>`;
}

function startEditItem(i) {
  const d = state.detail;
  d.open.add(i);
  d.editing = { i };
  renderDetailBody({ force: true });
}

function itemEditHtml(d, e, i) {
  const value = d.type === "hash" || d.type === "list" ? e[1] : e[0];
  const label = { hash: "Value", list: "Value", set: "Member", zset: "Member" }[d.type];
  return `<div class="item-body edit-form" data-form="item" data-i="${i}">
    <label class="field"><span class="field-label">${label}</span><textarea class="input mono grow" name="value" spellcheck="false" data-autofocus>${esc(showText(value))}</textarea></label>
    ${d.type === "zset" ? `<label class="field"><span class="field-label">Score</span><input class="input mono" name="score" value="${esc(e[1])}" inputmode="decimal"></label>` : ""}
    <div class="form-actions"><span class="muted small">⌘↩ to save</span><span class="spacer"></span><button class="button" data-action="edit-cancel">Cancel</button><button class="button primary" data-action="item-save" data-i="${i}">Save</button></div>
  </div>`;
}

function addFormHtml(d) {
  let fields = "";
  switch (d.type) {
    case "hash":
      fields = `<label class="field"><span class="field-label">Field</span><input class="input mono" name="field" spellcheck="false" data-autofocus></label>
        <label class="field"><span class="field-label">Value</span><textarea class="input mono grow" name="value" spellcheck="false"></textarea></label>`;
      break;
    case "list":
      fields = `<label class="field"><span class="field-label">Value</span><textarea class="input mono grow" name="value" spellcheck="false" data-autofocus></textarea></label>
        <label class="field"><span class="field-label">Where</span><select class="input" name="where"><option value="tail">At the end (RPUSH)</option><option value="head">At the start (LPUSH)</option></select></label>`;
      break;
    case "set":
      fields = `<label class="field"><span class="field-label">Member</span><textarea class="input mono grow" name="value" spellcheck="false" data-autofocus></textarea></label>`;
      break;
    case "zset":
      fields = `<label class="field"><span class="field-label">Member</span><textarea class="input mono grow" name="value" spellcheck="false" data-autofocus></textarea></label>
        <label class="field"><span class="field-label">Score</span><input class="input mono" name="score" inputmode="decimal" placeholder="0"></label>`;
      break;
    case "stream":
      fields = `<label class="field"><span class="field-label">Fields, one per line</span><textarea class="input mono grow" name="fields" spellcheck="false" placeholder="status=paid&#10;amount=12.50" data-autofocus></textarea></label>
        <label class="field"><span class="field-label">ID</span><input class="input mono" name="id" value="*" spellcheck="false"></label>`;
      break;
    default:
      return "";
  }
  return `<div class="add-form edit-form" data-form="add">${fields}
    <div class="form-actions"><span class="spacer"></span><button class="button" data-action="edit-cancel">Cancel</button><button class="button primary" data-action="add-save">Add</button></div></div>`;
}

function streamHtml(d, data) {
  let html = "";
  if (data.groups?.length) {
    html += section(
      "Consumer groups",
      data.groups
        .map((g) => kv(showText(g.name), `${plural(Number(g.consumers) || 0, "consumer")} · ${fmtNum(Number(g.pending) || 0)} pending · last ${showText(g["last-delivered-id"])}`))
        .join("")
    );
  }
  if (!data.entries.length) return html + emptyHtml("list", "No entries", "This stream is empty.");
  const rows = [];
  data.entries.forEach((e, i) => {
    if (!entryMatches(d, e)) return;
    const [id, fields] = e;
    const ms = Number(id.split("-")[0]);
    const pairs = [];
    for (let j = 0; j + 1 < fields.length; j += 2) pairs.push([showText(fields[j]), fields[j + 1]]);
    const open = d.open.has(i);
    rows.push(`<div class="item${open ? " open" : ""}">
      <div class="item-head stream-head" data-action="item" data-i="${i}" data-ctx="item" tabindex="0">
        <span class="item-k idx mono" title="${esc(ms ? new Date(ms).toLocaleString() : id)}">${esc(id)}</span>
        <span class="item-v">${esc(pairs.map(([k, v]) => `${k}=${preview(v, 40)}`).join("  "))}</span>
      </div>
      ${
        open
          ? `<div class="item-body">${ms ? `<div class="muted small">${esc(new Date(ms).toLocaleString())}</div>` : ""}${pairs.map(([k, v]) => kv(k, showText(v), { mono: true })).join("")}
              <div class="item-actions"><button class="text-btn" data-action="item-copy" data-i="${i}">${icon("copy")}<span>Copy ID</span></button><button class="text-btn danger" data-action="item-delete" data-i="${i}">${icon("trash")}<span>Remove</span></button></div></div>`
          : ""
      }
    </div>`);
  });
  html += `<div class="items items-stream"><div class="items-head"><span>ID</span><span>Fields · newest first</span></div>${rows.join("") || `<div class="muted small pad">Nothing matches “${esc(d.q)}”.</div>`}</div>`;
  if (!data.done) html += `<div class="more-row">${d.loadingMore ? `<span class="spin"></span>` : `<button class="link" data-action="k-more">Load older entries</button>`}<span class="muted">${fmtNum(data.entries.length)} of ${fmtNum(data.length)}</span></div>`;
  return html;
}

// ----- new key form

function newKeyHtml(d) {
  const f = d.draft;
  const types = NEW_TYPES.filter((t) => t !== "ReJSON-RL" || hasJson());
  const val = (n) => esc(f[n] ?? "");
  let fields = "";
  switch (d.type) {
    case "string":
      fields = `<label class="field"><span class="field-label">Value</span><textarea class="input mono grow" name="value" spellcheck="false">${val("value")}</textarea></label>`;
      break;
    case "hash":
      fields = `<label class="field"><span class="field-label">First field</span><input class="input mono" name="field" value="${val("field")}" spellcheck="false"></label>
        <label class="field"><span class="field-label">Value</span><textarea class="input mono grow" name="value" spellcheck="false">${val("value")}</textarea></label>`;
      break;
    case "list":
    case "set":
      fields = `<label class="field"><span class="field-label">First ${d.type === "list" ? "item" : "member"}</span><textarea class="input mono grow" name="value" spellcheck="false">${val("value")}</textarea></label>`;
      break;
    case "zset":
      fields = `<label class="field"><span class="field-label">First member</span><input class="input mono" name="value" value="${val("value")}" spellcheck="false"></label>
        <label class="field"><span class="field-label">Score</span><input class="input mono" name="score" value="${val("score") || "0"}" inputmode="decimal"></label>`;
      break;
    case "stream":
      fields = `<label class="field"><span class="field-label">First entry's fields, one per line</span><textarea class="input mono grow" name="fields" spellcheck="false" placeholder="status=created&#10;order=1001">${val("fields")}</textarea></label>`;
      break;
    case "ReJSON-RL":
      fields = `<label class="field"><span class="field-label">JSON</span><textarea class="input mono grow" name="value" spellcheck="false" placeholder='{"name": "Ada"}'>${val("value")}</textarea></label>`;
      break;
  }
  return `<div class="form" data-form="new-key">
    <label class="field"><span class="field-label">Name</span><input class="input mono" name="name" value="${val("name")}" placeholder="user:1001" spellcheck="false" autocomplete="off" data-autofocus></label>
    <div class="field"><span class="field-label">Type</span><div class="seg wrap">${types.map((t) => `<button class="seg-btn${d.type === t ? " on" : ""}" data-action="nk-type" data-type="${esc(t)}">${esc(typeInfo(t).label)}</button>`).join("")}</div></div>
    ${fields}
    <label class="field"><span class="field-label">Expire after</span><input class="input" name="ttl" value="${val("ttl")}" placeholder="Never · or 90, 10m, 2h, 7d" spellcheck="false"></label>
    ${d.error ? `<div class="inline-error">${icon("alert")}<div>${esc(d.error)}</div></div>` : ""}
    <div class="form-actions">${state.busy.get("new-key") ? `<span class="spin"></span>` : ""}<span class="spacer"></span><button class="button" data-action="d-back">Cancel</button><button class="button primary" data-action="nk-create">Create</button></div>
  </div>`;
}

// ----- connections

function connRow(c) {
  const active = c.id === state.activeId;
  const s = state.conn.status;
  const badge = active ? (s === "ok" ? `<span class="badge ok">In use</span>` : s === "connecting" ? `<span class="badge warn">Connecting</span>` : `<span class="badge bad">Not connected</span>`) : "";
  const ic = c.kind === "docker" ? "box" : c.source === "env" ? "env" : "server";
  return `<div class="row conn-row${active ? " active" : ""}" data-action="use-conn" data-id="${esc(c.id)}" data-ctx="conn" tabindex="0">
    <span class="row-icon${active && s === "ok" ? " used" : ""}">${icon(ic)}</span>
    <div class="row-main"><div class="line1"><span class="name">${esc(connName(c))}</span>${badge}</div><div class="line2"><span class="sub">${esc(connSub(c))}</span></div></div>
    <div class="row-actions">${isSaved(c) ? btn("pencil", "conn-edit", "Edit…", { id: c.id }) : ""}${btn("more", "menu", "More", { ctx: "conn", id: c.id })}</div>
  </div>`;
}

function connectionsHtml() {
  const dk = state.docker;
  const projectDocker = dk.containers.filter(inProject);
  const otherDocker = dk.containers.filter((d) => !inProject(d));
  let html = "";
  const projectRows = [...state.env.map(connRow), ...projectDocker.map((d) => connRow(dockerConn(d.name)))];
  if (projectRows.length) html += `<div class="section-label">In ${esc(state.project.name || "this project")}</div>${projectRows.join("")}`;
  html += `<div class="section-label">Saved</div>${state.saved.length ? state.saved.map(connRow).join("") : `<div class="list-note">No saved connections.</div>`}`;
  html += `<div class="section-label with-action"><span>Docker</span>${dk.loading ? `<span class="spin tiny"></span>` : btn("refresh", "docker-refresh", "Look again")}</div>`;
  if (dk.status === "ok") {
    html += otherDocker.length ? otherDocker.map((d) => connRow(dockerConn(d.name))).join("") : `<div class="list-note">${projectDocker.length ? "No other" : "No"} running Redis containers.</div>`;
  } else if (dk.status === "down") {
    html += `<div class="list-note">Docker isn't running.</div>`;
  } else if (dk.status === "missing") {
    html += `<div class="list-note">Docker isn't installed.</div>`;
  } else if (dk.status === "error") {
    html += `<div class="list-note">${esc(dk.message)}</div>`;
  } else {
    html += `<div class="list-note">Looking for Redis containers…</div>`;
  }
  html += `<div class="list-note">Containers connect with <code>docker exec</code>, so they work without a published port. Their password is read from the container's settings when it has one.</div>`;
  return html;
}

function connFormHtml(d) {
  const c = d.draft;
  const v = (x) => esc(x ?? "");
  return `<div class="form" data-form="conn">
    <label class="field"><span class="field-label">Paste a URL</span><input class="input mono" name="url" placeholder="redis://user:password@host:6379/0" spellcheck="false" autocomplete="off"></label>
    <div class="form-sep"><span>or fill in</span></div>
    <label class="field"><span class="field-label">Name</span><input class="input" name="name" value="${v(c.name)}" placeholder="${v(hostPort(c))}" spellcheck="false" autocomplete="off" ${d.id ? "" : "data-autofocus"}></label>
    <div class="field-row">
      <label class="field grow"><span class="field-label">Host</span><input class="input mono" name="host" value="${v(c.host)}" spellcheck="false" autocomplete="off"></label>
      <label class="field narrow"><span class="field-label">Port</span><input class="input mono" name="port" value="${v(c.port)}" inputmode="numeric"></label>
    </div>
    <div class="field-row">
      <label class="field grow"><span class="field-label">User</span><input class="input mono" name="username" value="${v(c.username)}" placeholder="default" spellcheck="false" autocomplete="off"></label>
      <label class="field narrow"><span class="field-label">Database</span><input class="input mono" name="db" value="${v(c.db || 0)}" inputmode="numeric"></label>
    </div>
    <label class="field"><span class="field-label">Password</span><input class="input mono" name="password" type="password" value="${v(c.password)}" autocomplete="off"></label>
    <label class="check"><input type="checkbox" name="tls" ${c.tls ? "checked" : ""}><span>Use TLS (rediss://)</span></label>
    <label class="check indent${c.tls ? "" : " disabled"}"><input type="checkbox" name="tlsInsecure" ${c.tlsInsecure ? "checked" : ""} ${c.tls ? "" : "disabled"}><span>Don't check the certificate</span></label>
    <div class="test-result" id="conn-test"></div>
    <div class="form-actions">
      ${d.id ? `<button class="button danger" data-action="conn-remove" data-id="${v(d.id)}">Remove</button>` : ""}
      <span class="spacer"></span>
      <button class="button" data-action="conn-test">Test</button>
      <button class="button primary" data-action="conn-save">${d.id ? "Save" : "Add & Connect"}</button>
    </div>
    <div class="form-note">Passwords are kept in this extension's Muxy storage, which isn't encrypted. Connecting runs <code>nc</code> (or <code>openssl</code> for TLS) on the project's computer.</div>
  </div>`;
}

function fillConnFromUrl(form, url) {
  const c = parseRedisUrl(url);
  if (!c) return;
  const set = (n, val) => {
    const el = form.querySelector(`[name="${n}"]`);
    if (el.type === "checkbox") el.checked = !!val;
    else el.value = val ?? "";
  };
  set("host", c.host);
  set("port", c.port);
  set("username", c.username);
  set("password", c.password);
  set("db", c.db);
  set("tls", c.tls);
  syncTlsBox(form);
}

function syncTlsBox(form) {
  const on = form.querySelector('[name="tls"]').checked;
  const box = form.querySelector('[name="tlsInsecure"]');
  box.disabled = !on;
  if (!on) box.checked = false;
  box.closest(".check").classList.toggle("disabled", !on);
}

// ---------------------------------------------------------------- events

function syncClear() {
  $(".search-clear").hidden = !$("#filter").value;
}

function refreshAll() {
  const b = $("#refresh-btn");
  b.classList.remove("spinning");
  void b.offsetWidth;
  b.classList.add("spinning");
  if (!isOk()) return connect(state.activeId);
  runTask("info");
  loadKeys({ refresh: true });
  if (state.detail?.kind === "key") loadKeyDetail({ quiet: true });
  if (state.detail?.kind === "connections") loadDocker();
  if (state.view === "server") runTask("server");
}

function handleAction(action, el) {
  const d = state.detail;
  const form = el.closest("[data-form]");
  switch (action) {
    case "refresh":
    case "retry":
      return refreshAll();
    case "app-menu":
      return openMenu(appMenu(), el);
    case "menu":
      return openMenu(menuFor(el), el);
    case "tab":
      return setView(el.dataset.view);
    case "connections":
      return openConnections();
    case "conn-new":
      return openConnForm();
    case "conn-edit":
      return openConnForm(el.dataset.id);
    case "use-conn":
      return useConn(el.dataset.id);
    case "conn-test":
      return testConnForm(form);
    case "conn-save":
      return saveConnForm(form);
    case "conn-remove":
      return removeConn(el.dataset.id);
    case "docker-refresh":
      return loadDocker();
    case "auth-submit":
      return submitAuth(form);
    case "clear-filter":
      $("#filter").value = "";
      state.filter = "";
      syncClear();
      return loadKeys({ reset: true });
    case "type-menu":
      return openMenu(typeMenu(), el);
    case "toggle-tree":
      state.tree = !state.tree;
      savePrefs();
      renderToolbar();
      return renderList();
    case "new-key":
      return openNewKey();
    case "load-more":
      return loadKeys({ more: true });
    case "folder": {
      const p = el.dataset.path;
      if (state.expanded.has(p)) state.expanded.delete(p);
      else state.expanded.add(p);
      return renderList();
    }
    case "open-key": {
      const it = state.keys.items[Number(el.dataset.k)];
      return it && openKey(it);
    }
    case "db-menu":
      return openMenu(dbMenu(), el);
    case "select-db":
      return selectDb(Number(el.dataset.db));
    case "copy":
      return copyText(el.dataset.copy);
    case "d-back":
      return leaveDetail();
    // key detail
    case "k-refresh":
      return loadKeyDetail();
    case "k-more":
      return loadKeyDetail({ more: true });
    case "k-ttl":
      return setTtl(d.key, d.name, d.expireAt);
    case "k-rename":
      d.renaming = true;
      return renderDetailChrome();
    case "k-copy":
      return copyText(d.name, "Copied the key name");
    case "k-delete":
      return deleteKey(d.key, d.name);
    case "k-copy-value":
      return copyText(showText(d.data?.value), "Copied the value");
    case "k-format":
      d.format = el.dataset.format;
      return renderDetailBody({ force: true });
    case "k-edit": {
      const raw = showText(d.data?.value);
      d.editing = { text: d.type === "ReJSON-RL" ? prettyJson(raw) ?? raw : raw };
      return renderDetail({ force: true });
    }
    case "k-add":
      d.adding = true;
      d.editing = null;
      return renderDetailBody({ force: true });
    case "value-save":
      return saveValue(form.querySelector('[name="value"]').value);
    case "edit-cancel":
      return cancelEdit();
    case "add-save":
      return addItem(form);
    case "item": {
      const i = Number(el.dataset.i);
      if (d.open.has(i)) d.open.delete(i);
      else d.open.add(i);
      if (d.editing?.i === i) d.editing = null;
      return renderDetailBody({ force: true });
    }
    case "item-copy": {
      const e = d.data.entries[Number(el.dataset.i)];
      if (d.type === "stream") return copyText(e[0], "Copied the ID");
      return copyText(showText(d.type === "hash" || d.type === "list" ? e[1] : e[0]), "Copied the value");
    }
    case "item-edit":
      return startEditItem(Number(el.dataset.i));
    case "item-save":
      return saveItem(Number(el.dataset.i), form);
    case "item-delete":
      return deleteItem(Number(el.dataset.i));
    case "zset-order":
      d.desc = !d.desc;
      return loadKeyDetail();
    // new key
    case "nk-type":
      readDraft($('[data-form="new-key"]'));
      d.type = el.dataset.type;
      d.error = "";
      return renderDetailBody({ force: true });
    case "nk-create":
      return createKey(form);
    // console
    case "console-clear":
      state.console.entries = [];
      renderList();
      return $("#console-in").focus({ preventScroll: true });
    case "console-recent": {
      const input = $("#console-in");
      input.value = state.console.history[Number(el.dataset.i)] || "";
      autosize(input);
      return input.focus({ preventScroll: true });
    }
    case "open-cli":
      return openCli();
    // server
    case "bgsave":
      return busy("bgsave", "Saving", async () => {
        const r = await q1(["BGSAVE"]);
        toast(String(r || "Saving a snapshot"));
        setTimeout(kickInfo, 1200);
      });
    case "slowlog-reset":
      return busy("slowlog", "Clearing", async () => {
        await q1(["SLOWLOG", "RESET"]);
        await loadServerExtras();
      });
    case "client-kill":
      return killClient(el.dataset.id, el.dataset.addr);
    default:
      return undefined;
  }
}

async function killClient(id, addr) {
  const ok = await confirm({ title: `Disconnect ${addr}?`, message: "Redis closes this client's connection. The program behind it may reconnect.", buttons: ["Disconnect", "Cancel"], default: "Cancel", cancel: "Cancel" });
  if (ok !== "Disconnect") return;
  await busy("client", "Disconnecting", async () => {
    await q1(["CLIENT", "KILL", "ID", String(id)]);
    toast(`Disconnected ${addr}`);
    await loadServerExtras();
  });
}

function bindEvents() {
  document.addEventListener("click", (e) => {
    const item = e.target.closest("#menu [data-menu]");
    if (item) {
      const it = menuItems?.[Number(item.dataset.menu)];
      closeMenu();
      if (it && !it.disabled) it.run();
      return;
    }
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled || el.closest("#menu")) return;
    e.preventDefault();
    handleAction(el.dataset.action, el);
  });

  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#menu") && !e.target.closest('[data-action="menu"], [data-action="app-menu"], [data-action="type-menu"], [data-action="db-menu"]')) closeMenu();
  });

  document.addEventListener("contextmenu", (e) => {
    const el = e.target.closest("[data-ctx]");
    if (!el) return;
    e.preventDefault();
    openMenu(menuFor(el), { x: e.clientX, y: e.clientY });
  });

  document.addEventListener("keydown", (e) => {
    const t = e.target;
    const typing = t.matches?.("input, textarea, select");
    const form = t.closest?.("[data-form]");
    const d = state.detail;

    if (t.id === "console-in") return onConsoleKey(e);
    if (t.id === "rename-in") {
      if (e.key === "Enter") {
        e.preventDefault();
        renameKey(t.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        d.renaming = false;
        renderDetailChrome();
      }
      return;
    }
    if (form && (e.key === "Enter" && (e.metaKey || e.ctrlKey) || (e.key === "s" && e.metaKey))) {
      e.preventDefault();
      const save = form.querySelector('[data-action$="-save"], [data-action="nk-create"], [data-action="auth-submit"]');
      if (save) handleAction(save.dataset.action, save);
      return;
    }
    if (form && e.key === "Enter" && t.tagName === "INPUT" && t.type !== "checkbox") {
      e.preventDefault();
      if (t.name === "url") return;
      const save = form.querySelector('[data-action$="-save"], [data-action="nk-create"], [data-action="auth-submit"]');
      if (save) handleAction(save.dataset.action, save);
      return;
    }
    if (e.key === "Escape") {
      if (!$("#menu").hidden) return closeMenu();
      if (d) {
        e.preventDefault();
        return leaveDetail();
      }
      if (t.id === "filter" && t.value) {
        t.value = "";
        state.filter = "";
        syncClear();
        return loadKeys({ reset: true });
      }
      if (typing) t.blur();
      return;
    }
    if (!$("#menu").hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const items = [...document.querySelectorAll("#menu .menu-item:not([disabled])")];
      const i = items.indexOf(document.activeElement);
      const next = i < 0 ? items[e.key === "ArrowDown" ? 0 : items.length - 1] : items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      next?.focus({ preventScroll: true });
      e.preventDefault();
      return;
    }
    if ((e.metaKey && e.key === "f") || (!typing && e.key === "/")) {
      e.preventDefault();
      if (d?.kind === "key" && $("#d-q")) return $("#d-q").focus({ preventScroll: true });
      if (d) closeDetail();
      if (state.view !== "keys") setView("keys");
      $("#filter").focus({ preventScroll: true });
      $("#filter").select();
      return;
    }
    if (!typing && e.key === "Enter") {
      const row = t.closest?.("[data-action]");
      if (row && row.matches(".row, .item-head")) {
        e.preventDefault();
        handleAction(row.dataset.action, row);
      }
    }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "filter") {
      state.filter = t.value;
      syncClear();
      return scheduleKeys();
    }
    if (t.id === "d-q" && state.detail) {
      state.detail.q = t.value;
      return renderDetailBody({ force: true });
    }
    if (t.id === "console-in") return autosize(t);
    if (t.name === "url" && t.closest('[data-form="conn"]')) return fillConnFromUrl(t.closest("form, [data-form]"), t.value);
    if (t.matches("textarea.grow")) autosize(t);
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "tls" && t.closest('[data-form="conn"]')) syncTlsBox(t.closest("[data-form]"));
  });

  $("#list").addEventListener("scroll", closeMenu, { passive: true });
  // The page itself never scrolls. Focusing a field in the detail pane while it
  // slides in would otherwise shift everything sideways and leave it there.
  window.addEventListener("scroll", () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  });
  window.addEventListener("blur", closeMenu);
  window.addEventListener("resize", closeMenu);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pump();
  });

  const m = mx();
  try {
    m.events?.subscribe?.("command.refresh", () => refreshAll());
    m.events?.subscribe?.("project.switched", () => onProjectChanged());
    m.events?.subscribe?.("worktree.switched", () => scheduleEnvScan());
    m.events?.subscribe?.("file.changed", (ev) => {
      const name = String(ev?.path || "").split("/").pop();
      if (isEnvFile(name)) scheduleEnvScan();
    });
  } catch (e) {
    console.warn("[redis] couldn't subscribe to events:", e?.message || e);
  }

  const applyScheme = (theme) => {
    if (theme?.colorScheme) document.documentElement.style.colorScheme = theme.colorScheme;
  };
  applyScheme(m.theme);
  try {
    m.onThemeChange?.(applyScheme);
  } catch {
    /* optional */
  }
}

function onConsoleKey(e) {
  const input = e.target;
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    const text = input.value;
    if (!text.trim()) return;
    runConsole(text).then((ran) => {
      if (ran) {
        input.value = "";
        autosize(input);
      }
    });
    return;
  }
  if (e.key === "ArrowUp" && !input.value.slice(0, input.selectionStart).includes("\n")) {
    e.preventDefault();
    return historyStep(1);
  }
  if (e.key === "ArrowDown" && !input.value.slice(input.selectionEnd).includes("\n")) {
    e.preventDefault();
    return historyStep(-1);
  }
  if (e.key === "l" && e.ctrlKey) {
    e.preventDefault();
    state.console.entries = [];
    renderList();
  }
  if (e.key === "Escape") input.blur();
}

// ---------------------------------------------------------------- init

function waitForMuxy(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (window.muxy) return resolve(window.muxy);
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (window.muxy) {
        clearInterval(timer);
        resolve(window.muxy);
      } else if (Date.now() - t0 > timeout) {
        clearInterval(timer);
        reject(new Error("The Muxy API isn't available"));
      }
    }, 25);
  });
}

async function init() {
  $("#refresh-btn").innerHTML = icon("refresh");
  $("#menu-btn").innerHTML = icon("more");
  $("#search-icon").innerHTML = icon("search");
  $(".search-clear").innerHTML = icon("x");

  let m;
  try {
    m = await waitForMuxy();
  } catch (e) {
    $("#list").innerHTML = stateScreen({ ic: "alert", title: "Open this page inside Muxy", text: e.message });
    return;
  }
  state.mode = m.panel ? "panel" : "sidebar";
  document.body.classList.add(`mode-${state.mode}`);
  await loadStored();
  bindEvents();
  await loadProject();
  await scanEnv();
  const pick = state.picks.projects[state.project.path] || state.picks.global || state.saved[0]?.id || "";
  state.activeId = pick;
  console.log(`[redis] ${state.mode} started`);
  renderAll();
  await connect(pick);
  setInterval(() => {
    pump();
    applyTtls();
  }, 500);
}

init().catch((e) => console.error("[redis] failed to start:", e?.stack || e));
