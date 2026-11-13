// The request tab. One tab edits one request: `muxy.data.id` names it. If that
// id is in the collections tree it's a saved request, otherwise an unsaved
// (scratch) one. Unsaved edits go to `draft:<id>` as you type, so they survive
// a restart, and the sidebar learns about them through the hub.
import {
  $, mx, esc, uid, debounce, initTheme, toast, toastError, copyText, confirmDialog, promptDialog, pick,
  openMenu, menuOpen, METHODS, methodClass, statusClass, fmtBytes, fmtMs, modKey, isMac,
} from "./ui.js";
import { icon } from "./icons.js";
import * as store from "./store.js";
import { prepare, send as sendHttp, toCurlCommand } from "./http.js";
import { looksLikeCurl, fromCurl } from "./curl.js";
import { markVars, unresolved, VAR_RE, isKnown } from "./vars.js";
import { highlight } from "./highlight.js";
import { mountKv } from "./kv.js";
import { mountCode } from "./code.js";

const MOD = isMac ? "⌘" : "Ctrl+";
const DEFAULT_NAMES = new Set(["", "Untitled Request", "New Request"]);
const HIGHLIGHT_LIMIT = 1_500_000;

const S = {
  id: null,
  inst: null,
  saved: false, // the id is in the collections tree
  savedJson: null,
  req: null,
  dirty: false,
  folderPath: [],
  envs: { active: null, globals: [], list: [] },
  vars: new Map(),
  tab: "params",
  inflight: null,
  startedAt: 0,
  response: null,
  analysis: null,
  error: null,
  resTab: "body",
  view: "pretty",
  prefs: { layout: "auto", ratio: 0.46, wrap: false, tab: "params" },
  saving: false,
  closing: false,
  finalized: false,
  kv: null,
  code: null,
  lastTitle: "",
};

let ticker = null;

// ---------------------------------------------------------------- helpers

function displayName() {
  const n = String(S.req?.name || "").trim();
  if (!DEFAULT_NAMES.has(n)) return n;
  return S.req?.url?.trim() ? store.suggestName(S.req) : "Untitled Request";
}

function computeDirty() {
  if (!S.req) return false;
  if (S.saved) return store.requestJson(S.req) !== S.savedJson;
  return store.hasContent(S.req);
}

function meta() {
  return { inst: S.inst, id: S.id, name: displayName(), method: S.req.method, url: S.req.url, dirty: S.dirty, scratch: !S.saved };
}

const publishState = debounce(() => store.hub("state", meta()), 200);

function hello() {
  store.hub("hello", { role: "tab", ...meta() });
}

function titleText() {
  return `${S.req.method} ${displayName()}${S.dirty ? " •" : ""}`;
}

function updateTitle(force = false) {
  const t = titleText();
  if (!force && t === S.lastTitle) return;
  S.lastTitle = t;
  mx().tabs?.setTitle?.(t)?.catch?.(() => {});
}

// A restored tab keeps its title, and setting the same title sends no event,
// so the hub can't learn this tab's id. Changing it briefly fixes that.
async function nudgeTitle() {
  const t = titleText();
  try {
    await mx().tabs.setTitle(`${t}​`);
    await mx().tabs.setTitle(t);
    S.lastTitle = t;
  } catch {}
}

// Shows {{vars}} with their values, but leaves $dynamic ones as they are,
// since those change on every send.
function previewResolve(text, depth = 0) {
  return String(text ?? "").replace(VAR_RE, (m, name) => {
    if (name.startsWith("$") || !S.vars.has(name)) return m;
    return depth < 5 ? previewResolve(S.vars.get(name), depth + 1) : S.vars.get(name);
  });
}

// ---------------------------------------------------------------- url <-> params

function splitUrl(url) {
  const hashAt = url.indexOf("#");
  const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const q = noHash.indexOf("?");
  return { base: q >= 0 ? noHash.slice(0, q) : noHash, query: q >= 0 ? noHash.slice(q + 1) : null, hash };
}

function parseQuery(query) {
  if (!query) return [];
  return query
    .split("&")
    .filter((p) => p !== "")
    .map((p) => {
      const i = p.indexOf("=");
      return { key: i < 0 ? p : p.slice(0, i), value: i < 0 ? "" : p.slice(i + 1), enabled: true };
    });
}

function syncParamsFromUrl() {
  const { query } = splitUrl(S.req.url);
  const parsed = parseQuery(query);
  const off = S.req.params.filter((p) => p.enabled === false);
  S.req.params.splice(0, S.req.params.length, ...parsed, ...off);
  if (S.tab === "params" && S.kv) S.kv.render();
}

function syncUrlFromParams() {
  const { base, hash } = splitUrl(S.req.url);
  const on = S.req.params.filter((p) => p.enabled !== false && (p.key || p.value));
  const query = on.map((p) => (p.value === "" ? p.key : `${p.key}=${p.value}`)).join("&");
  S.req.url = base + (query ? `?${query}` : "") + hash;
  const input = $("#url");
  if (input.value !== S.req.url) input.value = S.req.url;
  paintUrl();
  renderPreview();
}

// ---------------------------------------------------------------- loading

async function loadEnvs() {
  S.envs = await store.loadEnvs();
  S.vars = store.envVars(S.envs);
}

async function loadRequestState() {
  const tree = await store.loadTree();
  const node = store.nodeById(tree, S.id);
  const draft = await store.loadDraft(S.id);
  if (node && node.kind === "request") {
    S.saved = true;
    const saved = (await store.loadRequest(S.id)) || store.normalizeRequest({ id: S.id, name: node.name, method: node.method, url: node.url });
    saved.name = node.name;
    S.savedJson = store.requestJson(saved);
    S.req = draft ? draft.req : saved;
    S.folderPath = store.ancestors(tree, S.id).map((n) => n.name);
  } else {
    S.saved = false;
    S.savedJson = null;
    S.req = draft ? draft.req : store.emptyRequest({ id: S.id });
    S.folderPath = [];
  }
  S.req.id = S.id;
  S.dirty = computeDirty();
}

async function onTreeChanged(msg) {
  const tree = await store.loadTree();
  const node = store.nodeById(tree, S.id);
  if (node && node.kind === "request") {
    const touched = !msg.ids || msg.ids.includes(S.id) || !S.saved;
    S.folderPath = store.ancestors(tree, S.id).map((n) => n.name);
    if (touched) {
      const saved = (await store.loadRequest(S.id)) || store.normalizeRequest({ id: S.id, name: node.name, method: node.method, url: node.url });
      saved.name = node.name;
      S.saved = true;
      S.savedJson = store.requestJson(saved);
      // a rename from the sidebar wins over the name being edited here
      if (S.req.name !== node.name && document.activeElement?.id !== "name") S.req.name = node.name;
    }
  } else if (S.saved) {
    S.saved = false;
    S.savedJson = null;
    S.folderPath = [];
  }
  const was = S.dirty;
  S.dirty = computeDirty();
  if (was !== S.dirty) writeDraft();
  renderTop();
  updateTitle();
  publishState();
}

// ---------------------------------------------------------------- drafts & saving

const writeDraft = debounce(async () => {
  if (S.closing) return;
  try {
    if (S.saved) {
      if (S.dirty) await store.saveDraft(S.id, S.req);
      else await store.dropDraft(S.id);
    } else if (store.hasContent(S.req)) {
      await store.saveDraft(S.id, S.req, { scratch: true });
    } else {
      await store.dropDraft(S.id);
    }
  } catch (e) {
    console.warn("[rest] draft", e?.message || e);
  }
}, 400);

function changed() {
  const was = S.dirty;
  S.dirty = computeDirty();
  writeDraft();
  if (was !== S.dirty) publishState();
  renderTop();
  renderReqTabs();
  updateTitle();
}

async function chooseFolder() {
  const tree = await store.loadTree();
  const folders = store.folderPaths(tree);
  const items = [
    { id: "__root__", title: "Top level", subtitle: "Not in a folder" },
    ...folders.map((f) => ({ id: f.id, title: f.name, subtitle: f.path === f.name ? "Folder" : f.path })),
    { id: "__new__", title: "New Folder…", subtitle: "Create a folder at the top level" },
  ];
  const choice = await pick({ placeholder: "Save in which folder?", items });
  if (!choice) return undefined;
  if (choice.id === "__root__") return null;
  if (choice.id === "__new__") {
    const name = await promptDialog({ title: "New folder", placeholder: "Folder name" });
    if (name == null) return undefined;
    const folder = await store.createFolder(name.trim() || "New Folder", null);
    return folder.id;
  }
  return choice.id;
}

async function save() {
  if (S.saving) return false;
  if (S.saved) {
    if (!S.dirty) return true;
    S.saving = true;
    try {
      const r = await store.saveRequest(S.req);
      S.savedJson = store.requestJson(r);
      writeDraft.cancel();
      await store.dropDraft(S.id);
      S.dirty = computeDirty();
      store.notifyChanged("tree", { ids: [S.id] });
      toast("Saved");
      return true;
    } catch (e) {
      toastError(e, "Couldn't save");
      return false;
    } finally {
      S.saving = false;
      renderTop();
      updateTitle();
      publishState();
    }
  }

  const suggested = DEFAULT_NAMES.has(String(S.req.name).trim()) ? store.suggestName(S.req) : S.req.name;
  const name = await promptDialog({ title: "Save request", placeholder: `Name (leave empty for “${suggested}”)` });
  if (name == null) return false;
  const parent = await chooseFolder();
  if (parent === undefined) return false;
  S.saving = true;
  try {
    S.req.name = name.trim() || suggested;
    const r = await store.createRequest(S.req, parent);
    S.saved = true;
    S.savedJson = store.requestJson(r);
    writeDraft.cancel();
    await store.dropDraft(S.id);
    const tree = await store.loadTree();
    S.folderPath = store.ancestors(tree, S.id).map((n) => n.name);
    S.dirty = computeDirty();
    store.notifyChanged("tree", { ids: [S.id] });
    toast(S.folderPath.length ? `Saved to ${S.folderPath.join(" / ")}` : "Saved to collections");
    return true;
  } catch (e) {
    toastError(e, "Couldn't save");
    return false;
  } finally {
    S.saving = false;
    renderAll();
    publishState();
  }
}

async function discard() {
  if (!S.saved || !S.savedJson) return;
  S.req = store.normalizeRequest(JSON.parse(S.savedJson));
  writeDraft.cancel();
  await store.dropDraft(S.id);
  S.dirty = false;
  renderAll();
  publishState();
}

async function deleteRequest() {
  const choice = await confirmDialog({
    title: `Delete “${displayName()}”?`,
    message: "It's removed from your collections and this tab closes.",
    buttons: ["Delete", "Cancel"],
    default: "Cancel",
    cancel: "Cancel",
  });
  if (choice !== "Delete") return;
  const ids = await store.removeNode(S.id);
  store.notifyChanged("tree", { ids, removed: true });
  S.closing = true;
  finalize();
  mx().lifecycle.close();
}

// ---------------------------------------------------------------- closing

function needsAsk() {
  return !S.closing && S.dirty;
}

function finalize() {
  if (S.finalized) return;
  S.finalized = true;
  writeDraft.cancel();
  store.hub("bye", { inst: S.inst });
  if (!S.saved) store.dropDraft(S.id);
}

function beforeClose() {
  if (S.closing || !needsAsk()) {
    if (S.saved && S.dirty) writeDraft.flush();
    finalize();
    return false;
  }
  // Answer Muxy right away (it closes pages that take longer than 5 s), then
  // ask, and close from here once the user has chosen.
  setTimeout(askBeforeClose, 0);
  return true;
}

async function askBeforeClose() {
  const choice = await confirmDialog({
    title: S.saved ? `Save changes to “${displayName()}”?` : `Save “${displayName()}” before closing?`,
    message: S.saved ? "Your changes are lost if you don't save them." : "This request isn't in your collections yet.",
    buttons: ["Save", "Don't Save", "Cancel"],
    default: "Save",
    cancel: "Cancel",
  });
  if (choice === "Save") {
    if (!(await save())) return;
  } else if (choice === "Don't Save") {
    writeDraft.cancel();
    await store.dropDraft(S.id);
  } else {
    return;
  }
  S.closing = true;
  finalize();
  mx().lifecycle.close();
}

function closeFromSidebar(force) {
  if (force) {
    S.closing = true;
    finalize();
    mx().lifecycle.close();
    return;
  }
  if (needsAsk()) askBeforeClose();
  else {
    S.closing = true;
    finalize();
    mx().lifecycle.close();
  }
}

// ---------------------------------------------------------------- sending

function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    const el = $("#elapsed");
    if (el) el.textContent = fmtMs(performance.now() - S.startedAt);
  }, 100);
}

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

function analyzeBody(res) {
  const ct = String(res.contentType || "").toLowerCase();
  const body = res.body || "";
  let kind = "text";
  if (/json/.test(ct)) kind = "json";
  else if (/html/.test(ct)) kind = "html";
  else if (/xml/.test(ct)) kind = "xml";
  else if (/^(image|audio|video|font)\/|octet-stream|application\/(pdf|zip|gzip|x-tar|x-7z|wasm|x-protobuf|protobuf|msgpack)/.test(ct)) kind = "binary";
  let pretty = body;
  if (kind === "json" || kind === "text") {
    const t = body.trim();
    if (t && (kind === "json" || t[0] === "{" || t[0] === "[")) {
      try {
        pretty = JSON.stringify(JSON.parse(t), null, 2);
        kind = "json";
      } catch {
        if (kind === "json") kind = "text";
      }
    }
  }
  return { kind, pretty };
}

function requestTexts() {
  const r = S.req;
  const out = [r.url, ...r.headers.filter((h) => h.enabled !== false).flatMap((h) => [h.key, h.value])];
  if (["json", "text", "xml"].includes(r.body.mode)) out.push(r.body.text);
  if (r.body.mode === "form") out.push(...r.body.form.filter((x) => x.enabled !== false).flatMap((x) => [x.key, x.value]));
  if (r.body.mode === "multipart") out.push(...r.body.multipart.filter((x) => x.enabled !== false).flatMap((x) => [x.key, x.value]));
  if (r.auth.type === "bearer") out.push(r.auth.token, r.auth.prefix);
  if (r.auth.type === "basic") out.push(r.auth.username, r.auth.password);
  if (r.auth.type === "apikey") out.push(r.auth.key, r.auth.value);
  return out;
}

async function send() {
  if (S.inflight) return;
  let p;
  try {
    p = prepare(S.req, S.vars);
  } catch (e) {
    S.error = e;
    S.response = null;
    renderResponse();
    if (e.kind === "input") $("#url").focus({ preventScroll: true });
    return;
  }
  const missing = unresolved(requestTexts(), S.vars);
  if (missing.length) {
    toast(`Not defined, sent as written: ${missing.map((n) => `{{${n}}}`).join(", ")}`, { kind: "info", timeout: 5000 });
  }
  const job = sendHttp(p);
  S.inflight = job;
  S.startedAt = performance.now();
  S.error = null;
  renderUrlBar();
  renderResponse();
  startTicker();
  const snapshot = store.normalizeRequest(S.req);
  let res = null;
  let err = null;
  try {
    res = await job.promise;
  } catch (e) {
    err = e;
  }
  if (S.inflight !== job) return;
  S.inflight = null;
  stopTicker();
  if (err && err.kind === "cancelled") {
    toast("Request cancelled", { kind: "info" });
  } else if (err) {
    S.error = err;
    S.response = null;
    S.analysis = null;
  } else {
    S.response = res;
    S.analysis = analyzeBody(res);
    S.showBinary = false;
    if (S.view === "preview" && S.analysis.kind !== "html") S.view = "pretty";
  }
  renderUrlBar();
  renderResponse();
  if (!err || err.kind !== "cancelled") {
    store
      .pushHistory({
        req: { ...snapshot, name: displayName() },
        status: res?.status || 0,
        ms: Math.round(res?.timing?.total || performance.now() - S.startedAt),
        size: res?.bodyBytes || 0,
        error: err ? err.message : "",
        requestId: S.saved ? S.id : null,
      })
      .then(() => store.notifyChanged("history"))
      .catch((e) => console.warn("[rest] history", e?.message || e));
  }
}

function cancelSend() {
  S.inflight?.cancel();
}

// ---------------------------------------------------------------- environments

async function setActiveEnv(id) {
  try {
    S.envs = await store.updateEnvs((e) => {
      e.active = id;
    });
    S.vars = store.envVars(S.envs);
    store.notifyChanged("envs");
    onVarsChanged();
  } catch (e) {
    toastError(e, "Couldn't switch environment");
  }
}

function onVarsChanged() {
  renderEnvPill();
  paintUrl();
  renderPreview();
  S.code?.setVars(S.vars);
}

async function openSidebar(extra) {
  try {
    if (extra) await store.sset("ui:pending", { ...extra, at: Date.now() });
    await mx().panels.open(store.PANEL);
    if (extra) store.relay(extra);
  } catch (e) {
    toastError(e, "Couldn't open the sidebar");
  }
}

function envMenu(anchor) {
  openMenu(
    [
      { header: "Environment" },
      { label: "No Environment", checked: !S.envs.active, run: () => setActiveEnv(null) },
      ...S.envs.list.map((e) => ({ label: e.name, checked: e.id === S.envs.active, run: () => setActiveEnv(e.id) })),
      "-",
      { label: "Manage Environments…", icon: "sliders", run: () => openSidebar({ type: "show-envs" }) },
    ],
    anchor
  );
}

// ---------------------------------------------------------------- menus

function setLayout(layout) {
  S.prefs.layout = layout;
  applyLayout();
  store.savePrefs("request", S.prefs);
}

function moreMenu(anchor) {
  const L = S.prefs.layout;
  openMenu(
    [
      { label: "Copy as cURL", icon: "terminal", run: copyCurl },
      { label: "Duplicate in New Tab", icon: "copy", run: duplicate },
      S.saved ? { label: "Show in Sidebar", icon: "sidebar", run: () => openSidebar({ type: "reveal", id: S.id }) } : null,
      !S.saved ? { label: "Save to Collections…", icon: "save", run: save } : null,
      "-",
      { header: "Layout" },
      { label: "Automatic", checked: L === "auto", run: () => setLayout("auto") },
      { label: "Side by Side", checked: L === "cols", run: () => setLayout("cols") },
      { label: "Stacked", checked: L === "rows", run: () => setLayout("rows") },
      "-",
      S.saved && S.dirty ? { label: "Discard Changes", icon: "undo", run: discard } : null,
      S.saved ? { label: "Delete Request…", icon: "trash", danger: true, run: deleteRequest } : null,
    ],
    anchor
  );
}

function methodMenu(anchor) {
  openMenu(
    [
      ...METHODS.map((m) => ({
        html: `<span class="mbadge ${methodClass(m)}">${m}</span>`,
        label: m,
        checked: S.req.method === m,
        run: () => setMethod(m),
      })),
      "-",
      {
        label: "Custom…",
        checked: !METHODS.includes(S.req.method),
        run: async () => {
          const v = await promptDialog({ title: "Custom method", placeholder: "e.g. PROPFIND" });
          const m = String(v || "").trim().toUpperCase();
          if (m && /^[A-Z0-9!#$%&'*+.^_`|~-]+$/.test(m)) setMethod(m);
          else if (m) toast("A method is one word of letters, digits, and - _ .", { kind: "error" });
        },
      },
    ],
    anchor,
    { align: "left" }
  );
}

function setMethod(m) {
  S.req.method = m;
  renderUrlBar();
  changed();
  publishState();
}

async function copyCurl() {
  try {
    copyText(toCurlCommand(prepare(S.req, S.vars)), "Copied as cURL");
  } catch (e) {
    toastError(e);
  }
}

async function duplicate() {
  try {
    await store.openScratch({ ...S.req, name: `${displayName()} copy` });
  } catch (e) {
    toastError(e, "Couldn't duplicate");
  }
}

function applyImport(imported) {
  const keepName = !DEFAULT_NAMES.has(String(S.req.name).trim());
  S.req = store.normalizeRequest({ ...imported, id: S.id, name: keepName ? S.req.name : imported.name });
  renderAll();
  changed();
  publishState();
  toast("Imported the curl command");
}

// ---------------------------------------------------------------- render: top

function renderTop() {
  const crumbs = $("#crumbs");
  const nameFocused = document.activeElement?.id === "name";
  if (!nameFocused) {
    const folders = S.folderPath.map((f) => `<span class="crumb">${esc(f)}</span><span class="crumb-sep">/</span>`).join("");
    crumbs.innerHTML = `${S.saved ? icon(S.folderPath.length ? "folder" : "layers", "crumb-icon") : icon("file", "crumb-icon")}${folders}<input id="name" class="rq-name" spellcheck="false" autocomplete="off" aria-label="Request name" placeholder="${esc(displayName())}"><span class="rq-state" id="rq-state"></span>`;
    const input = $("#name");
    input.value = DEFAULT_NAMES.has(String(S.req.name).trim()) && !S.saved ? "" : S.req.name;
    sizeName(input);
  }
  const st = $("#rq-state");
  if (st) {
    st.innerHTML = !S.saved
      ? `<span class="chip-note">Not saved</span>`
      : S.dirty
        ? `<span class="dirty-dot" title="Unsaved changes"></span>`
        : "";
  }
  const save = $("#save-btn");
  save.innerHTML = `${icon("save")}<span>${S.saved ? "Save" : "Save…"}</span>`;
  save.disabled = S.saving || (S.saved ? !S.dirty : false);
  save.title = `${S.saved ? "Save" : "Save to collections"} (${MOD}S)`;
  renderEnvPill();
}

let measureCtx = null;
function sizeName(input) {
  const text = input.value || input.placeholder || "";
  try {
    measureCtx ||= document.createElement("canvas").getContext("2d");
    const cs = getComputedStyle(input);
    measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    input.style.width = `${Math.ceil(measureCtx.measureText(text).width) + 16}px`;
  } catch {
    input.size = Math.max(6, Math.min(60, text.length + 1));
  }
}

function renderEnvPill() {
  const env = store.activeEnv(S.envs);
  const pill = $("#env-pill");
  pill.classList.toggle("on", !!env);
  pill.innerHTML = `${icon("layers")}<span>${esc(env ? env.name : "No Environment")}</span>${icon("chevron-down", "pill-chev")}`;
}

// ---------------------------------------------------------------- render: url bar

function urlHtml(url) {
  const q = url.indexOf("?");
  const mv = (t) => markVars(t, S.vars);
  if (q < 0) return mv(url);
  let out = mv(url.slice(0, q));
  let state = "key";
  for (const part of url.slice(q).split(/([?&=#])/)) {
    if (!part) continue;
    if (part === "?" || part === "&") {
      if (state === "hash") {
        out += esc(part);
        continue;
      }
      state = "key";
      out += `<span class="u-sep">${esc(part)}</span>`;
    } else if (part === "=" && state === "key") {
      state = "val";
      out += `<span class="u-sep">=</span>`;
    } else if (part === "#") {
      state = "hash";
      out += `<span class="u-sep">#</span>`;
    } else {
      out += `<span class="u-${state}">${mv(part)}</span>`;
    }
  }
  return out;
}

function paintUrl() {
  const input = $("#url");
  $("#url-hl").innerHTML = urlHtml(input.value) || "";
  syncUrlScroll();
}

function syncUrlScroll() {
  const input = $("#url");
  $("#url-hl").style.transform = `translateX(${-input.scrollLeft}px)`;
}

function renderUrlBar() {
  const mb = $("#method-btn");
  mb.innerHTML = `<span class="mbadge ${methodClass(S.req.method)}">${esc(S.req.method)}</span>${icon("chevron-down", "pill-chev")}`;
  const input = $("#url");
  if (input.value !== S.req.url) input.value = S.req.url;
  paintUrl();
  const btn = $("#send-btn");
  if (S.inflight) {
    btn.classList.add("cancel");
    btn.innerHTML = `${icon("stop")}<span>Cancel</span>`;
    btn.title = "Cancel (Esc)";
  } else {
    btn.classList.remove("cancel");
    btn.innerHTML = `${icon("send")}<span>Send</span>`;
    btn.title = `Send (${MOD}↵)`;
  }
}

function renderPreview() {
  const el = $("#url-preview");
  const url = S.req.url;
  const names = [...String(url).matchAll(VAR_RE)].map((m) => m[1]);
  if (!names.length) {
    el.hidden = true;
    return;
  }
  const missing = names.filter((n) => !isKnown(n, S.vars));
  el.hidden = false;
  el.innerHTML = `<span class="pv-arrow">→</span><span class="pv-url mono">${markVars(previewResolve(url), S.vars)}</span>${
    missing.length ? `<span class="pv-warn">${icon("alert")}${esc(missing.length === 1 ? `{{${missing[0]}}} isn't defined` : `${missing.length} variables aren't defined`)}</span>` : ""
  }`;
}

// ---------------------------------------------------------------- render: request config

const TABS = [
  { id: "params", label: "Params" },
  { id: "headers", label: "Headers" },
  { id: "body", label: "Body" },
  { id: "auth", label: "Auth" },
  { id: "settings", label: "Settings" },
];

function tabBadge(id) {
  const r = S.req;
  const count = (rows) => rows.filter((x) => x.enabled !== false && x.key).length;
  if (id === "params") return count(r.params) || "";
  if (id === "headers") return count(r.headers) || "";
  if (id === "body") return r.body.mode === "none" ? "" : store.BODY_MODES.find((m) => m.id === r.body.mode)?.label.split(" ")[0] || "";
  if (id === "auth") return r.auth.type === "none" ? "" : store.AUTH_TYPES.find((a) => a.id === r.auth.type)?.label.split(" ")[0] || "";
  if (id === "settings") {
    const s = r.settings;
    const n = (s.followRedirects ? 0 : 1) + (s.insecure ? 1 : 0) + (s.timeoutSec !== 30 ? 1 : 0) + (s.compressed ? 0 : 1);
    return n ? "•" : "";
  }
  return "";
}

function renderReqTabs() {
  $("#req-tabs").innerHTML = TABS.map((t) => {
    const b = tabBadge(t.id);
    return `<button class="subtab${S.tab === t.id ? " active" : ""}" role="tab" data-tab="${t.id}">${t.label}${b !== "" ? `<span class="subtab-badge">${esc(b)}</span>` : ""}</button>`;
  }).join("");
}

function autoHeaders() {
  const r = S.req;
  const has = (n) => r.headers.some((h) => h.enabled !== false && h.key.trim().toLowerCase() === n.toLowerCase());
  const out = [];
  const ct = { json: "application/json", text: "text/plain", xml: "application/xml", form: "application/x-www-form-urlencoded", multipart: "multipart/form-data; boundary=…" }[r.body.mode];
  if (ct && !has("content-type")) out.push(["Content-Type", ct, "Body"]);
  if (r.auth.type === "bearer" && r.auth.token && !has("authorization")) out.push(["Authorization", `${r.auth.prefix ? r.auth.prefix + " " : ""}••••`, "Auth"]);
  if (r.auth.type === "basic" && (r.auth.username || r.auth.password) && !has("authorization")) out.push(["Authorization", "Basic ••••", "Auth"]);
  if (r.auth.type === "apikey" && r.auth.key && r.auth.in === "header" && !has(r.auth.key)) out.push([r.auth.key, "••••", "Auth"]);
  if (r.settings.compressed && !has("accept-encoding")) out.push(["Accept-Encoding", "deflate, gzip, br, zstd", "Settings"]);
  if (!has("user-agent")) out.push(["User-Agent", "curl/…", "curl"]);
  if (!has("accept")) out.push(["Accept", "*/*", "curl"]);
  return out;
}

function renderReqPane() {
  const host = $("#req-pane");
  S.kv = null;
  S.code = null;
  host.classList.toggle("fill", S.tab === "body" && ["json", "text", "xml"].includes(S.req.body.mode));
  switch (S.tab) {
    case "params":
      host.innerHTML = `<div class="pane-pad"><div class="kv-mount"></div><p class="pane-hint">Query parameters stay in sync with the URL. Untick one to keep it here without sending it.</p></div>`;
      S.kv = mountKv($(".kv-mount", host), {
        rows: S.req.params,
        keyPlaceholder: "Parameter",
        onChange: () => {
          syncUrlFromParams();
          changed();
        },
      });
      break;
    case "headers": {
      const auto = autoHeaders();
      host.innerHTML = `<div class="pane-pad"><div class="kv-mount"></div>${
        auto.length
          ? `<div class="auto-headers"><div class="auto-title">Also sent</div>${auto
              .map(([k, v, from]) => `<div class="auto-row"><span></span><span class="mono">${esc(k)}</span><span class="auto-val"><span class="mono muted">${esc(v)}</span><span class="auto-from">${esc(from)}</span></span><span></span></div>`)
              .join("")}</div>`
          : ""
      }</div>`;
      S.kv = mountKv($(".kv-mount", host), {
        rows: S.req.headers,
        keyPlaceholder: "Header",
        keyList: "header-names",
        valueList: "header-values",
        onChange: changed,
      });
      break;
    }
    case "body":
      renderBodyPane(host);
      break;
    case "auth":
      renderAuthPane(host);
      break;
    case "settings":
      renderSettingsPane(host);
      break;
  }
}

function jsonStatus(text) {
  if (!text.trim()) return { ok: true, text: "" };
  // variables may stand in for numbers or whole values, so swap them out first
  const probe = text.replace(VAR_RE, "0");
  try {
    JSON.parse(probe);
    return { ok: true, text: "Valid JSON" };
  } catch (e) {
    const msg = String(e.message || e).replace(/^JSON\.parse:\s*/, "").replace(/^SyntaxError:\s*/, "");
    return { ok: false, text: msg };
  }
}

// Pretty-prints JSON that may contain {{variables}} outside strings.
function beautifyJson(text) {
  const vars = [];
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === "{" && text[i + 1] === "{") {
      const end = text.indexOf("}}", i + 2);
      if (end > 0) {
        vars.push(text.slice(i, end + 2));
        out += `"__MUXY_VAR_${vars.length - 1}__"`;
        i = end + 1;
        continue;
      }
    }
    out += c;
  }
  const pretty = JSON.stringify(JSON.parse(out), null, 2);
  return pretty.replace(/"__MUXY_VAR_(\d+)__"/g, (_, n) => vars[Number(n)]);
}

const updateJsonStatus = debounce(() => {
  const el = $("#json-status");
  if (!el || S.req.body.mode !== "json") return;
  const st = jsonStatus(S.req.body.text);
  el.className = `json-status ${st.ok ? "ok" : "bad"}`;
  el.innerHTML = st.text ? `${icon(st.ok ? "check" : "alert")}<span>${esc(st.text)}</span>` : "";
}, 250);

function renderBodyPane(host) {
  const b = S.req.body;
  const modes = store.BODY_MODES.map((m) => `<button class="${b.mode === m.id ? "active" : ""}" data-body-mode="${m.id}">${m.id === "form" ? "Form" : m.id === "multipart" ? "Multipart" : m.label}</button>`).join("");
  const isCode = ["json", "text", "xml"].includes(b.mode);
  host.innerHTML = `<div class="body-wrap${isCode ? " code-mode" : ""}">
    <div class="body-bar"><div class="seg">${modes}</div><span class="spacer"></span>${
      b.mode === "json" ? `<span class="json-status" id="json-status"></span><button class="btn" data-act="beautify" title="Format JSON (${MOD}⇧F)">${icon("wand")}<span>Format</span></button>` : ""
    }</div>
    <div class="body-main"></div>
  </div>`;
  const main = $(".body-main", host);
  if (b.mode === "none") {
    main.innerHTML = `<div class="pane-empty">${icon("braces")}<div>This request has no body.</div><div class="muted">Pick JSON, Text, XML, or a form above to add one.</div></div>`;
  } else if (isCode) {
    S.code = mountCode(main, {
      value: b.text,
      language: b.mode === "text" ? "text" : b.mode,
      vars: S.vars,
      placeholder: b.mode === "json" ? '{\n  "name": "{{name}}"\n}' : b.mode === "xml" ? "<request></request>" : "Text body",
      onChange: (v) => {
        S.req.body.text = v;
        changed();
        updateJsonStatus();
      },
    });
    updateJsonStatus();
  } else if (b.mode === "form") {
    main.classList.add("pane-pad");
    S.kv = mountKv(main, { rows: b.form, keyPlaceholder: "Field", onChange: changed });
  } else if (b.mode === "multipart") {
    main.classList.add("pane-pad");
    S.kv = mountKv(main, {
      rows: b.multipart,
      keyPlaceholder: "Field",
      types: true,
      bulk: false,
      note: "File paths are relative to the project folder.",
      onChange: changed,
    });
  }
}

function renderAuthPane(host) {
  const a = S.req.auth;
  const types = store.AUTH_TYPES.map((t) => `<option value="${t.id}"${a.type === t.id ? " selected" : ""}>${esc(t.label)}</option>`).join("");
  let fields = "";
  if (a.type === "bearer") {
    fields = `
      <label class="frow"><span class="flabel">Token</span><input class="field mono" data-auth="token" value="${esc(a.token)}" placeholder="{{token}}" spellcheck="false" autocomplete="off"></label>
      <label class="frow"><span class="flabel">Prefix</span><input class="field mono narrow" data-auth="prefix" value="${esc(a.prefix)}" placeholder="None" spellcheck="false" autocomplete="off"></label>
      <p class="pane-hint">Sent as <span class="mono">Authorization: ${esc(a.prefix ? a.prefix + " " : "")}&lt;token&gt;</span>.</p>`;
  } else if (a.type === "basic") {
    fields = `
      <label class="frow"><span class="flabel">Username</span><input class="field mono" data-auth="username" value="${esc(a.username)}" spellcheck="false" autocomplete="off"></label>
      <label class="frow"><span class="flabel">Password</span><input class="field mono" data-auth="password" type="password" value="${esc(a.password)}" spellcheck="false" autocomplete="off"><button class="icon-btn" data-act="reveal-pass" title="Show password">${icon("eye")}</button></label>
      <p class="pane-hint">Sent as <span class="mono">Authorization: Basic &lt;base64 of username:password&gt;</span>.</p>`;
  } else if (a.type === "apikey") {
    fields = `
      <label class="frow"><span class="flabel">Key</span><input class="field mono" data-auth="key" value="${esc(a.key)}" placeholder="X-API-Key" spellcheck="false" autocomplete="off"></label>
      <label class="frow"><span class="flabel">Value</span><input class="field mono" data-auth="value" value="${esc(a.value)}" placeholder="{{apiKey}}" spellcheck="false" autocomplete="off"></label>
      <label class="frow"><span class="flabel">Add to</span><select class="field narrow" data-auth="in"><option value="header"${a.in === "header" ? " selected" : ""}>Header</option><option value="query"${a.in === "query" ? " selected" : ""}>Query</option></select></label>`;
  } else {
    fields = `<p class="pane-hint">This request sends no authorization. You can still add an Authorization header yourself.</p>`;
  }
  host.innerHTML = `<div class="pane-pad form">
    <label class="frow"><span class="flabel">Type</span><select class="field narrow" data-auth="type">${types}</select></label>
    ${fields}
    ${a.type !== "none" ? `<p class="pane-hint">Use <span class="mono">{{variables}}</span> to keep secrets in an environment. A header you add in Headers takes precedence.</p>` : ""}
  </div>`;
}

function renderSettingsPane(host) {
  const s = S.req.settings;
  host.innerHTML = `<div class="pane-pad form">
    <label class="check"><input type="checkbox" data-set="followRedirects"${s.followRedirects ? " checked" : ""}>Follow redirects</label>
    <label class="check"><input type="checkbox" data-set="compressed"${s.compressed ? " checked" : ""}>Accept compressed responses (gzip, br, zstd) and decode them</label>
    <label class="check"><input type="checkbox" data-set="insecure"${s.insecure ? " checked" : ""}>Skip TLS certificate verification</label>
    <label class="frow"><span class="flabel">Timeout</span><input class="field narrow" type="number" min="0" max="290" step="1" data-set="timeoutSec" value="${esc(s.timeoutSec)}"><span class="muted">seconds, 0 for none</span></label>
    <p class="pane-hint">Requests go out through <span class="mono">curl</span> on the project's machine, so <span class="mono">localhost</span> works, and a remote project calls from where its code runs.</p>
  </div>`;
}

// ---------------------------------------------------------------- render: response

function renderResponse() {
  const host = $("#response");
  if (S.inflight) {
    host.innerHTML = `<div class="res-state">
      <span class="spin big"></span>
      <div class="res-state-title">Sending <span class="mono" id="elapsed">${fmtMs(performance.now() - S.startedAt)}</span></div>
      <button class="btn" data-act="cancel">${icon("stop")}<span>Cancel</span></button>
    </div>`;
    return;
  }
  if (S.error) {
    host.innerHTML = `<div class="res-state error">
      ${icon("alert", "res-state-icon")}
      <div class="res-state-title selectable">${esc(S.error.message)}</div>
      ${S.error.hint ? `<div class="res-state-text">${esc(S.error.hint)}</div>` : ""}
      <div class="res-state-actions"><button class="btn" data-act="send">${icon("send")}<span>Try Again</span></button>${
        S.error.kind !== "input" ? `<button class="btn" data-act="copy-curl">${icon("terminal")}<span>Copy as cURL</span></button>` : ""
      }</div>
    </div>`;
    return;
  }
  if (!S.response) {
    host.innerHTML = `<div class="res-state idle">
      ${icon("send", "res-state-icon")}
      <div class="res-state-title">Send the request to see its response</div>
      <div class="keys">
        <span><kbd>${MOD}↵</kbd> Send</span>
        <span><kbd>${MOD}S</kbd> Save</span>
        <span><kbd>${MOD}L</kbd> URL</span>
      </div>
      <div class="res-state-text">Paste a curl command into the URL field to import it.</div>
    </div>`;
    return;
  }
  const r = S.response;
  const a = S.analysis;
  const headerCount = r.headers.length;
  const warn = r.truncated ? "Response cut off at 4 MB" : r.warning;
  host.innerHTML = `<div class="res-head">
      <div class="res-meta">
        <span class="sbadge ${statusClass(r.status)}" title="${esc(r.httpVersion ? `HTTP/${r.httpVersion}` : "")}">${r.status} ${esc(r.statusText)}</span>
        <span class="res-num" title="Total time">${icon("clock")}${fmtMs(r.timing.total)}</span>
        <span class="res-num" title="${esc(`Body ${r.bodyBytes} bytes${r.transferBytes && r.transferBytes !== r.bodyBytes ? `, ${r.transferBytes} transferred` : ""}`)}">${fmtBytes(r.bodyBytes)}</span>
        ${warn ? `<span class="res-warn" title="${esc(warn)}">${icon("alert")}<span>${esc(warn)}</span></span>` : ""}
      </div>
      <nav class="subtabs res-tabs">
        <button class="subtab${S.resTab === "body" ? " active" : ""}" data-res-tab="body">Body</button>
        <button class="subtab${S.resTab === "headers" ? " active" : ""}" data-res-tab="headers">Headers<span class="subtab-badge">${headerCount}</span></button>
        <button class="subtab${S.resTab === "timing" ? " active" : ""}" data-res-tab="timing">Timing</button>
      </nav>
    </div>
    <div class="res-content" id="res-content"></div>`;
  const content = $("#res-content");
  if (S.resTab === "headers") renderResHeaders(content, r);
  else if (S.resTab === "timing") renderTiming(content, r);
  else renderResBody(content, r, a);
}

function lineNumbers(text) {
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  let s = "";
  for (let i = 1; i <= n; i++) s += i === n ? i : `${i}\n`;
  return s;
}

function renderResBody(host, r, a) {
  const views = [
    ["pretty", "Pretty"],
    ["raw", "Raw"],
  ];
  if (a.kind === "html") views.push(["preview", "Preview"]);
  const view = views.some(([v]) => v === S.view) ? S.view : "pretty";
  const tools = `<div class="res-tools">
    <div class="seg">${views.map(([v, l]) => `<button class="${view === v ? "active" : ""}" data-view="${v}">${l}</button>`).join("")}</div>
    <span class="res-kind">${esc(a.kind === "binary" ? r.contentType || "binary" : a.kind.toUpperCase())}</span>
    <span class="spacer"></span>
    <button class="icon-btn${S.prefs.wrap ? " on" : ""}" data-act="wrap" title="Wrap lines">${icon("wrap")}</button>
    <button class="icon-btn" data-act="copy-body" title="Copy body">${icon("copy")}</button>
  </div>`;
  if (!r.body) {
    host.innerHTML = `${tools}<div class="res-empty">No body${r.status === 204 ? " (204 No Content)" : r.status === 304 ? " (304 Not Modified)" : ""}.</div>`;
    return;
  }
  if (a.kind === "binary" && !S.showBinary) {
    host.innerHTML = `${tools}<div class="res-empty">${icon("file")}<div>Binary response, ${esc(r.contentType || "unknown type")}, ${fmtBytes(r.transferBytes || r.bodyBytes)}.</div><button class="link-btn" data-act="show-binary">Show it as text anyway</button></div>`;
    return;
  }
  if (view === "preview") {
    host.innerHTML = `${tools}<div class="res-preview"><iframe sandbox="" referrerpolicy="no-referrer" title="HTML preview"></iframe></div>`;
    host.querySelector("iframe").srcdoc = r.body;
    return;
  }
  const text = view === "pretty" ? a.pretty : r.body;
  const lang = view === "pretty" && text.length < HIGHLIGHT_LIMIT ? (a.kind === "json" ? "json" : a.kind === "xml" || a.kind === "html" ? "xml" : "text") : "text";
  const wrap = S.prefs.wrap;
  host.innerHTML = `${tools}<div class="viewer scroll${wrap ? " wrap" : ""}">${wrap ? "" : `<div class="viewer-gutter" aria-hidden="true">${lineNumbers(text)}</div>`}<pre class="viewer-code selectable">${highlight(text, lang)}</pre></div>`;
}

function renderResHeaders(host, r) {
  host.innerHTML = `<div class="res-tools"><span class="res-kind">${r.headers.length} headers${r.redirects ? ` · after ${r.redirects} redirect${r.redirects === 1 ? "" : "s"}` : ""}</span><span class="spacer"></span><button class="icon-btn" data-act="copy-headers" title="Copy headers">${icon("copy")}</button></div>
  <div class="hdr-list scroll selectable">${
    r.headers.map(([k, v]) => `<div class="hdr-row"><span class="hdr-k mono">${esc(k)}</span><span class="hdr-v mono">${esc(v)}</span></div>`).join("") ||
    '<div class="res-empty">No headers.</div>'
  }</div>`;
}

function renderTiming(host, r) {
  const t = r.timing;
  const rows = [];
  if (r.engine === "curl") {
    const phases = [
      ["DNS lookup", t.dns],
      ["TCP connect", t.tcp],
      ["TLS handshake", t.tls],
      ["Waiting for server", t.wait],
      ["Download", t.download],
    ];
    const total = t.total || 1;
    let offset = 0;
    for (const [label, ms] of phases) {
      const left = (offset / total) * 100;
      const width = Math.max(0.4, (ms / total) * 100);
      rows.push(`<div class="tm-row"><span class="tm-label">${label}</span><span class="tm-track"><span class="tm-bar" style="left:${left.toFixed(2)}%;width:${Math.min(100 - left, width).toFixed(2)}%"></span></span><span class="tm-val mono">${ms ? fmtMs(ms) : "—"}</span></div>`);
      offset += ms;
    }
  }
  const info = [
    ["Total", fmtMs(t.total)],
    r.remoteIp ? ["Remote address", `${r.remoteIp}${r.remotePort ? `:${r.remotePort}` : ""}`] : null,
    r.httpVersion ? ["HTTP version", r.httpVersion] : null,
    ["Redirects", String(r.redirects)],
    r.url ? ["Final URL", r.url] : null,
    ["Uploaded", fmtBytes(r.uploadBytes)],
    ["Downloaded", r.transferBytes && r.transferBytes !== r.bodyBytes ? `${fmtBytes(r.transferBytes)} (${fmtBytes(r.bodyBytes)} decoded)` : fmtBytes(r.bodyBytes)],
    ["Sent with", r.engine === "curl" ? "curl, on the project's machine" : "Muxy web request"],
  ].filter(Boolean);
  host.innerHTML = `<div class="timing scroll">
    ${rows.length ? `<div class="tm-chart">${rows.join("")}</div>` : ""}
    <div class="tm-info selectable">${info.map(([k, v]) => `<div class="tm-k">${esc(k)}</div><div class="tm-v mono">${esc(v)}</div>`).join("")}</div>
    ${r.redirectChain?.length ? `<div class="tm-redirects"><div class="auto-title">Redirects</div>${r.redirectChain.map((x) => `<div class="tm-redirect"><span class="sbadge ${statusClass(x.status)}">${x.status}</span><span class="mono selectable">${esc(x.location)}</span></div>`).join("")}</div>` : ""}
  </div>`;
}

// ---------------------------------------------------------------- layout

let autoCols = false;

function applyLayout() {
  const split = $("#split");
  const cols = S.prefs.layout === "cols" || (S.prefs.layout === "auto" && autoCols);
  split.classList.toggle("cols", cols);
  split.classList.toggle("rows", !cols);
  $("#divider").setAttribute("aria-orientation", cols ? "vertical" : "horizontal");
  split.style.setProperty("--ratio", String(S.prefs.ratio));
}

function initSplitter() {
  const divider = $("#divider");
  const split = $("#split");
  let dragging = false;
  divider.addEventListener("pointerdown", (e) => {
    dragging = true;
    divider.setPointerCapture(e.pointerId);
    split.classList.add("dragging");
    e.preventDefault();
  });
  divider.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = split.getBoundingClientRect();
    const cols = split.classList.contains("cols");
    const ratio = cols ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
    S.prefs.ratio = Math.max(0.18, Math.min(0.82, ratio));
    split.style.setProperty("--ratio", String(S.prefs.ratio));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    split.classList.remove("dragging");
    store.savePrefs("request", S.prefs);
  };
  divider.addEventListener("pointerup", end);
  divider.addEventListener("pointercancel", end);
  divider.addEventListener("dblclick", () => {
    S.prefs.ratio = 0.46;
    applyLayout();
    store.savePrefs("request", S.prefs);
  });
  new ResizeObserver(([entry]) => {
    const next = entry.contentRect.width >= 980;
    if (next !== autoCols) {
      autoCols = next;
      applyLayout();
    }
  }).observe($("#app"));
}

function renderAll() {
  renderTop();
  renderUrlBar();
  renderPreview();
  renderReqTabs();
  renderReqPane();
  renderResponse();
  applyLayout();
  updateTitle();
}

// ---------------------------------------------------------------- events

function bindEvents() {
  const url = $("#url");
  url.addEventListener("input", () => {
    S.req.url = url.value;
    syncParamsFromUrl();
    paintUrl();
    renderPreview();
    changed();
    publishState();
  });
  for (const ev of ["scroll", "keyup", "keydown", "click", "select", "focus", "blur"]) url.addEventListener(ev, () => requestAnimationFrame(syncUrlScroll));
  url.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain") || "";
    if (!looksLikeCurl(text)) return;
    e.preventDefault();
    const imported = fromCurl(text);
    if (imported) applyImport(imported);
    else toast("Couldn't read that curl command", { kind: "error" });
  });
  url.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !modKey(e) && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });

  $("#crumbs").addEventListener("input", (e) => {
    if (e.target.id !== "name") return;
    S.req.name = e.target.value.trim() ? e.target.value : S.saved ? e.target.value : "Untitled Request";
    sizeName(e.target);
    changed();
    publishState();
  });
  $("#crumbs").addEventListener("keydown", (e) => {
    if (e.target.id === "name" && (e.key === "Enter" || e.key === "Escape")) {
      e.preventDefault();
      e.target.blur();
    }
  });
  $("#crumbs").addEventListener(
    "blur",
    (e) => {
      if (e.target.id !== "name") return;
      if (S.saved && !S.req.name.trim()) {
        S.req.name = "Untitled Request";
        changed();
      }
      setTimeout(renderTop, 0);
    },
    true
  );

  $("#method-btn").addEventListener("click", (e) => methodMenu(e.currentTarget));
  $("#env-pill").addEventListener("click", (e) => envMenu(e.currentTarget));
  $("#more-btn").addEventListener("click", (e) => moreMenu(e.currentTarget));
  $("#save-btn").addEventListener("click", save);
  $("#send-btn").addEventListener("click", () => (S.inflight ? cancelSend() : send()));

  $("#req-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b || b.dataset.tab === S.tab) return;
    S.tab = b.dataset.tab;
    S.prefs.tab = S.tab;
    store.savePrefs("request", S.prefs);
    renderReqTabs();
    renderReqPane();
  });

  const pane = $("#req-pane");
  pane.addEventListener("click", (e) => {
    const mode = e.target.closest("[data-body-mode]");
    if (mode) {
      const next = mode.dataset.bodyMode;
      if (next === S.req.body.mode) return;
      S.req.body.mode = next;
      changed();
      renderReqPane();
      if (["json", "text", "xml"].includes(next)) S.code?.focus();
      return;
    }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "beautify") formatBody();
    else if (act === "reveal-pass") {
      const input = pane.querySelector('[data-auth="password"]');
      if (input) input.type = input.type === "password" ? "text" : "password";
    }
  });
  pane.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.auth && t.tagName === "INPUT") {
      S.req.auth[t.dataset.auth] = t.value;
      changed();
    } else if (t.dataset.set === "timeoutSec") {
      const n = Number(t.value);
      S.req.settings.timeoutSec = Number.isFinite(n) ? Math.max(0, Math.min(290, Math.round(n))) : 30;
      changed();
    }
  });
  pane.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.auth && t.tagName === "SELECT") {
      S.req.auth[t.dataset.auth] = t.value;
      changed();
      renderReqPane();
    } else if (t.dataset.set && t.type === "checkbox") {
      S.req.settings[t.dataset.set] = t.checked;
      changed();
    }
  });

  const res = $("#response");
  res.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-res-tab]");
    if (tab) {
      S.resTab = tab.dataset.resTab;
      renderResponse();
      return;
    }
    const view = e.target.closest("[data-view]");
    if (view) {
      S.view = view.dataset.view;
      renderResponse();
      return;
    }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "cancel") cancelSend();
    else if (act === "send") send();
    else if (act === "copy-curl") copyCurl();
    else if (act === "wrap") {
      S.prefs.wrap = !S.prefs.wrap;
      store.savePrefs("request", S.prefs);
      renderResponse();
    } else if (act === "copy-body" && S.response) {
      copyText(S.view === "raw" ? S.response.body : S.analysis?.pretty ?? S.response.body, "Body copied");
    } else if (act === "copy-headers" && S.response) {
      copyText(S.response.headers.map(([k, v]) => `${k}: ${v}`).join("\n"), "Headers copied");
    } else if (act === "show-binary") {
      S.showBinary = true;
      renderResponse();
    }
  });

  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (modKey(e) && e.key === "Enter") {
      e.preventDefault();
      if (!S.inflight) send();
    } else if (modKey(e) && k === "s" && !e.altKey) {
      e.preventDefault();
      save();
    } else if (modKey(e) && k === "l" && !e.shiftKey) {
      e.preventDefault();
      const u = $("#url");
      u.focus({ preventScroll: true });
      u.select();
    } else if (modKey(e) && e.shiftKey && k === "f" && S.tab === "body" && S.req.body.mode === "json") {
      e.preventDefault();
      formatBody();
    } else if (e.key === "Escape" && S.inflight && !menuOpen()) {
      cancelSend();
    }
  });
}

function formatBody() {
  if (S.req.body.mode !== "json") return;
  try {
    const pretty = beautifyJson(S.req.body.text);
    if (S.code) {
      // replace through the textarea so Undo can bring the old text back
      const ta = S.code.textarea;
      ta.focus({ preventScroll: true });
      ta.select();
      if (!document.execCommand?.("insertText", false, pretty)) S.code.set(pretty);
    }
    S.req.body.text = pretty;
    changed();
    updateJsonStatus();
  } catch (e) {
    toast(`Not valid JSON: ${String(e.message || e).replace(/^JSON\.parse:\s*/, "")}`, { kind: "error" });
  }
}

function onBus(msg) {
  switch (msg.type) {
    case "hub-ready":
      hello();
      break;
    case "need-tab-id":
      if (msg.inst === S.inst) nudgeTitle();
      break;
    case "changed":
      if (msg.what === "envs" && msg.from !== store.PAGE) loadEnvs().then(onVarsChanged);
      else if (msg.what === "tree") onTreeChanged(msg);
      break;
    case "close":
      if ((Array.isArray(msg.insts) && msg.insts.includes(S.inst)) || (Array.isArray(msg.ids) && msg.ids.includes(S.id))) closeFromSidebar(!!msg.force);
      break;
  }
}

// ---------------------------------------------------------------- boot

async function boot() {
  initTheme();
  const m = mx();
  if (!m) {
    document.body.innerHTML = '<p style="padding:20px">Open this page from Muxy.</p>';
    return;
  }
  S.inst = m.tabInstanceID || uid();
  const data = m.data || {};
  S.id = data.id ? String(data.id) : `t-${S.inst}`;
  S.prefs = await store.loadPrefs("request", S.prefs);
  S.tab = TABS.some((t) => t.id === S.prefs.tab) ? S.prefs.tab : "params";
  await Promise.all([loadEnvs(), loadRequestState()]);
  if (S.tab === "body" && S.req.body.mode === "none" && S.req.method === "GET") S.tab = "params";

  $("#more-btn").innerHTML = icon("more");
  bindEvents();
  initSplitter();
  renderAll();
  updateTitle(true);
  m.tabs?.setIcon?.({ symbol: "curlybraces" })?.catch?.(() => {});
  store.onBus(onBus);
  hello();
  m.lifecycle?.onBeforeClose?.(beforeClose);
  if (!S.req.url) $("#url").focus({ preventScroll: true });
}

boot().catch((e) => {
  console.error("[rest] request tab failed to start", e);
  document.body.innerHTML = `<p style="padding:20px">Couldn't open this request: ${esc(e?.message || e)}</p>`;
});
