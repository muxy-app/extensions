// Everything the extension keeps lives in Muxy's per-extension storage:
//
//   tree          folders and saved requests: { nodes: [{ id, kind, name, parent, method, url }] }
//                 (array order is the order inside each folder)
//   req:<id>      a saved request
//   draft:<id>    unsaved edits to a request, or an unsaved (scratch) request
//   envs          { active, globals: [kv], list: [{ id, name, vars: [kv] }] }
//   history       the most recent sends, newest first
//   prefs:<page>  view settings
//
// Pages tell each other about changes through the background hub.
import { mx, uid } from "./ui.js";

export const EXT = "rest-client-extension";
export const TAB_TYPE = "request";
export const PANEL = "rest";
const HISTORY_MAX = 100;
// Identifies this page in change notices, so it can skip its own.
export const PAGE = uid();

// ---------------------------------------------------------------- storage

export async function sget(key, fallback = null) {
  try {
    const v = await mx().storage.get(key);
    return v ?? fallback;
  } catch (e) {
    console.warn("[rest] storage.get", key, e?.message || e);
    return fallback;
  }
}

export async function sset(key, value) {
  await mx().storage.set(key, value);
}

export async function sdel(key) {
  try {
    await mx().storage.delete(key);
  } catch (e) {
    console.warn("[rest] storage.delete", key, e?.message || e);
  }
}

export async function skeys() {
  try {
    return (await mx().storage.keys()) || [];
  } catch {
    return [];
  }
}

// One read-modify-write at a time from this page.
let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------- hub

export function hub(type, payload = {}) {
  try {
    return Promise.resolve(mx().events.emit("extension.hub", { type, ...payload })).catch((e) => console.warn("[rest] hub", e?.message || e));
  } catch (e) {
    console.warn("[rest] hub", e?.message || e);
    return Promise.resolve();
  }
}

export function relay(msg) {
  return hub("relay", { msg });
}

export function notifyChanged(what, extra = {}) {
  return relay({ type: "changed", what, from: PAGE, ...extra });
}

export function onBus(fn) {
  try {
    return mx().events.subscribe("extension.bus", (p) => {
      try {
        fn(p || {});
      } catch (e) {
        console.error("[rest] bus handler", e);
      }
    });
  } catch (e) {
    console.warn("[rest] can't listen to the hub", e?.message || e);
    return () => {};
  }
}

// ---------------------------------------------------------------- model

export const BODY_MODES = [
  { id: "none", label: "None" },
  { id: "json", label: "JSON" },
  { id: "text", label: "Text" },
  { id: "xml", label: "XML" },
  { id: "form", label: "Form URL-Encoded" },
  { id: "multipart", label: "Multipart Form" },
];

export const AUTH_TYPES = [
  { id: "none", label: "No Auth" },
  { id: "bearer", label: "Bearer Token" },
  { id: "basic", label: "Basic Auth" },
  { id: "apikey", label: "API Key" },
];

function kvList(list, withType = false) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const row = { key: String(r.key ?? ""), value: String(r.value ?? ""), enabled: r.enabled !== false };
      if (withType) row.type = r.type === "file" ? "file" : "text";
      return row;
    });
}

// Builds every request with the same key order, so JSON.stringify can be used
// to tell whether a working copy differs from the saved one.
export function normalizeRequest(r = {}) {
  const body = r.body || {};
  const auth = r.auth || {};
  const settings = r.settings || {};
  const mode = BODY_MODES.some((m) => m.id === body.mode) ? body.mode : "none";
  return {
    id: String(r.id || uid()),
    name: String(r.name ?? "Untitled Request"),
    method: String(r.method || "GET").toUpperCase(),
    url: String(r.url ?? ""),
    params: kvList(r.params),
    headers: kvList(r.headers),
    body: {
      mode,
      text: String(body.text ?? ""),
      form: kvList(body.form),
      multipart: kvList(body.multipart, true),
    },
    auth: {
      type: AUTH_TYPES.some((a) => a.id === auth.type) ? auth.type : "none",
      token: String(auth.token ?? ""),
      prefix: String(auth.prefix ?? "Bearer"),
      username: String(auth.username ?? ""),
      password: String(auth.password ?? ""),
      key: String(auth.key ?? ""),
      value: String(auth.value ?? ""),
      in: auth.in === "query" ? "query" : "header",
    },
    settings: {
      followRedirects: settings.followRedirects !== false,
      timeoutSec: Number.isFinite(Number(settings.timeoutSec)) ? Math.max(0, Math.min(290, Number(settings.timeoutSec))) : 30,
      insecure: !!settings.insecure,
      compressed: settings.compressed !== false,
    },
  };
}

export function emptyRequest(over = {}) {
  return normalizeRequest({ name: "Untitled Request", ...over });
}

export function requestJson(r) {
  return JSON.stringify(normalizeRequest(r));
}

export function hasContent(r) {
  if (!r) return false;
  return !!(String(r.url || "").trim() || String(r.body?.text || "").trim() || r.headers?.some((h) => h.key || h.value));
}

// A short name for a request that has none: the last part of its path.
export function suggestName(r) {
  const url = String(r?.url || "").trim();
  if (!url) return "Untitled Request";
  let path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "").split(/[?#]/)[0];
  if (!path || path === "/") path = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0];
  const parts = path.split("/").filter(Boolean);
  const name = parts.slice(-2).join("/") || path;
  return name.length > 48 ? name.slice(0, 47) + "…" : name || "Untitled Request";
}

// ---------------------------------------------------------------- tree

function normalizeTree(t) {
  const nodes = Array.isArray(t?.nodes) ? t.nodes.filter((n) => n && n.id && (n.kind === "folder" || n.kind === "request")) : [];
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) if (n.parent && !ids.has(n.parent)) n.parent = null;
  return { nodes };
}

export async function loadTree() {
  return normalizeTree(await sget("tree", null));
}

async function writeTree(tree) {
  await sset("tree", { nodes: tree.nodes });
}

export function nodeById(tree, id) {
  return tree.nodes.find((n) => n.id === id) || null;
}

export function childrenOf(tree, parent) {
  return tree.nodes.filter((n) => (n.parent || null) === (parent || null));
}

export function ancestors(tree, id) {
  const out = [];
  let n = nodeById(tree, id);
  const seen = new Set();
  while (n && n.parent && !seen.has(n.parent)) {
    seen.add(n.parent);
    n = nodeById(tree, n.parent);
    if (n) out.unshift(n);
  }
  return out;
}

export function descendants(tree, id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const c of childrenOf(tree, out[i])) out.push(c.id);
  return out;
}

export function folderPaths(tree) {
  const out = [];
  const walk = (parent, prefix) => {
    for (const n of childrenOf(tree, parent)) {
      if (n.kind !== "folder") continue;
      const path = prefix ? `${prefix} / ${n.name}` : n.name;
      out.push({ id: n.id, name: n.name, path });
      walk(n.id, path);
    }
  };
  walk(null, "");
  return out;
}

function insertAt(tree, node, parent, beforeId) {
  node.parent = parent || null;
  const before = beforeId ? tree.nodes.findIndex((n) => n.id === beforeId) : -1;
  if (before >= 0) {
    tree.nodes.splice(before, 0, node);
  } else {
    // after the last node in that folder, so siblings stay together
    let last = -1;
    tree.nodes.forEach((n, i) => {
      if ((n.parent || null) === (parent || null)) last = i;
    });
    tree.nodes.splice(last >= 0 ? last + 1 : tree.nodes.length, 0, node);
  }
}

function metaOf(req) {
  return { name: req.name, method: req.method, url: req.url };
}

export function createFolder(name, parent = null) {
  return locked(async () => {
    const tree = await loadTree();
    const node = { id: uid(), kind: "folder", name: name || "New Folder", parent: parent || null };
    insertAt(tree, node, parent, null);
    await writeTree(tree);
    return node;
  });
}

// Saves `req` under its own id and adds it to the tree.
export function createRequest(req, parent = null) {
  return locked(async () => {
    const tree = await loadTree();
    const r = normalizeRequest(req);
    await sset(`req:${r.id}`, r);
    const existing = nodeById(tree, r.id);
    if (existing) Object.assign(existing, metaOf(r));
    else insertAt(tree, { id: r.id, kind: "request", parent: parent || null, ...metaOf(r) }, parent, null);
    await writeTree(tree);
    return r;
  });
}

export function saveRequest(req) {
  return locked(async () => {
    const r = normalizeRequest(req);
    await sset(`req:${r.id}`, r);
    const tree = await loadTree();
    const node = nodeById(tree, r.id);
    if (node) {
      Object.assign(node, metaOf(r));
      await writeTree(tree);
    }
    return r;
  });
}

export async function loadRequest(id) {
  const r = await sget(`req:${id}`, null);
  return r ? normalizeRequest({ ...r, id }) : null;
}

export function renameNode(id, name) {
  return locked(async () => {
    const tree = await loadTree();
    const node = nodeById(tree, id);
    if (!node) return null;
    node.name = name;
    await writeTree(tree);
    if (node.kind === "request") {
      const r = await sget(`req:${id}`, null);
      if (r) await sset(`req:${id}`, { ...r, name });
      const d = await sget(`draft:${id}`, null);
      if (d?.req) await sset(`draft:${id}`, { ...d, req: { ...d.req, name } });
    }
    return node;
  });
}

export function moveNode(id, parent, beforeId = null) {
  return locked(async () => {
    const tree = await loadTree();
    const node = nodeById(tree, id);
    if (!node || id === beforeId) return false;
    if (parent && descendants(tree, id).includes(parent)) return false;
    tree.nodes = tree.nodes.filter((n) => n.id !== id);
    insertAt(tree, node, parent, beforeId);
    await writeTree(tree);
    return true;
  });
}

// Removes a node and everything under it. Returns the removed ids.
export function removeNode(id) {
  return locked(async () => {
    const tree = await loadTree();
    if (!nodeById(tree, id)) return [];
    const ids = descendants(tree, id);
    const gone = new Set(ids);
    tree.nodes = tree.nodes.filter((n) => !gone.has(n.id));
    await writeTree(tree);
    for (const x of ids) {
      await sdel(`req:${x}`);
      await sdel(`draft:${x}`);
    }
    return ids;
  });
}

export function duplicateNode(id) {
  return locked(async () => {
    const tree = await loadTree();
    const src = nodeById(tree, id);
    if (!src) return null;
    const copyInto = async (node, parent, beforeId, rename) => {
      const copy = { ...node, id: uid(), name: rename ? `${node.name} copy` : node.name, parent };
      insertAt(tree, copy, parent, beforeId);
      if (node.kind === "request") {
        const r = (await sget(`req:${node.id}`, null)) || metaOf(node);
        await sset(`req:${copy.id}`, normalizeRequest({ ...r, id: copy.id, name: copy.name }));
      } else {
        for (const c of childrenOf(tree, node.id).filter((c) => c.id !== copy.id)) await copyInto(c, copy.id, null, false);
      }
      return copy;
    };
    const siblings = childrenOf(tree, src.parent);
    const next = siblings[siblings.indexOf(src) + 1];
    const copy = await copyInto(src, src.parent || null, next ? next.id : null, true);
    await writeTree(tree);
    return copy;
  });
}

// ---------------------------------------------------------------- drafts

export async function loadDraft(id) {
  const d = await sget(`draft:${id}`, null);
  return d && d.req ? { ...d, req: normalizeRequest({ ...d.req, id }) } : null;
}

export async function saveDraft(id, req, extra = {}) {
  await sset(`draft:${id}`, { req: normalizeRequest({ ...req, id }), at: Date.now(), ...extra });
}

export async function dropDraft(id) {
  await sdel(`draft:${id}`);
}

export async function draftIds() {
  return new Set((await skeys()).filter((k) => k.startsWith("draft:")).map((k) => k.slice(6)));
}

// ---------------------------------------------------------------- environments

function normalizeEnvs(e) {
  const list = Array.isArray(e?.list)
    ? e.list.filter((x) => x && x.id).map((x) => ({ id: String(x.id), name: String(x.name || "Environment"), vars: kvList(x.vars) }))
    : [];
  const active = list.some((x) => x.id === e?.active) ? e.active : null;
  return { active, globals: kvList(e?.globals), list };
}

export async function loadEnvs() {
  return normalizeEnvs(await sget("envs", null));
}

export async function saveEnvs(envs) {
  await sset("envs", normalizeEnvs(envs));
}

export function updateEnvs(fn) {
  return locked(async () => {
    const envs = await loadEnvs();
    const next = (await fn(envs)) || envs;
    await saveEnvs(next);
    return normalizeEnvs(next);
  });
}

// Globals first, then the active environment, which wins on clashes.
export function envVars(envs) {
  const map = new Map();
  const add = (rows) => {
    for (const r of rows || []) if (r.enabled !== false && String(r.key).trim()) map.set(String(r.key).trim(), String(r.value ?? ""));
  };
  add(envs?.globals);
  add(envs?.list?.find((e) => e.id === envs.active)?.vars);
  return map;
}

export function activeEnv(envs) {
  return envs?.list?.find((e) => e.id === envs.active) || null;
}

// ---------------------------------------------------------------- history

export async function loadHistory() {
  const h = await sget("history", []);
  return Array.isArray(h) ? h.filter((x) => x && x.id && x.req) : [];
}

const BODY_CAP = 64 * 1024;

export function pushHistory(entry) {
  return locked(async () => {
    const req = normalizeRequest(entry.req);
    if (req.body.text.length > BODY_CAP) req.body.text = req.body.text.slice(0, BODY_CAP);
    const item = { ...entry, id: entry.id || uid(), at: entry.at || Date.now(), req };
    let list = [item, ...(await loadHistory())].slice(0, HISTORY_MAX);
    try {
      await sset("history", list);
    } catch {
      // storage is full: keep fewer
      list = list.slice(0, 20);
      await sset("history", list);
    }
    return item;
  });
}

export function removeHistory(id) {
  return locked(async () => {
    const list = (await loadHistory()).filter((x) => x.id !== id);
    await sset("history", list);
  });
}

export function clearHistory() {
  return locked(() => sset("history", []));
}

// ---------------------------------------------------------------- prefs

export async function loadPrefs(page, defaults) {
  const p = await sget(`prefs:${page}`, null);
  return { ...defaults, ...(p && typeof p === "object" ? p : {}) };
}

export async function savePrefs(page, prefs) {
  try {
    await sset(`prefs:${page}`, prefs);
  } catch (e) {
    console.warn("[rest] prefs", e?.message || e);
  }
}

// ---------------------------------------------------------------- tabs

export async function openRequestTab(id, extra = {}) {
  return mx().tabs.open({ kind: "extensionWebView", extension: { id: EXT, tabType: TAB_TYPE, data: { id, ...extra } } });
}

// Opens `req` as a new unsaved request.
export async function openScratch(req) {
  const id = uid();
  await saveDraft(id, { ...req, id }, { scratch: true });
  return openRequestTab(id, { scratch: true });
}
