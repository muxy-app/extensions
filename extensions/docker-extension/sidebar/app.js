import { api, DockerError, parsePorts, portUrl, splitArgs, shq, parseSize, formatBytes } from "./docker.js";
import { icon } from "./icons.js";

// ---------------------------------------------------------------- helpers

const $ = (sel, root = document) => root.querySelector(sel);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const cmp = (a, b) => collator.compare(a || "", b || "");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isMac = /Mac/i.test(navigator.platform || navigator.userAgent || "");
const mx = () => window.muxy;

function attrs(data) {
  return Object.entries(data)
    .filter(([, v]) => v != null)
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join("");
}

function btn(ic, action, title, data = {}, { disabled = false, cls = "" } = {}) {
  return `<button class="icon-btn ${cls}" data-action="${action}" title="${esc(title)}" aria-label="${esc(title)}"${attrs(data)}${disabled ? " disabled" : ""}>${icon(ic)}</button>`;
}

const spinner = (label) => `<span class="busy-inline" title="${esc(label)}"><span class="spin"></span></span>`;

function ago(iso) {
  if (!iso || String(iso).startsWith("0001")) return "";
  const t = Date.parse(String(iso).replace(/(\.\d{3})\d+/, "$1"));
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  const units = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, secs] of units) {
    if (s >= secs) return `${plural(Math.floor(s / secs), unit)} ago`;
  }
  return "just now";
}

function fmtTime(ts) {
  const t = Date.parse(String(ts).replace(/(\.\d{3})\d+/, "$1"));
  if (!t) return "";
  return new Date(t).toLocaleTimeString([], { hour12: false });
}

// ---------------------------------------------------------------- state

const VIEWS = [
  { id: "containers", label: "Containers", noun: "containers" },
  { id: "images", label: "Images", noun: "images" },
  { id: "volumes", label: "Volumes", noun: "volumes" },
  { id: "networks", label: "Networks", noun: "networks" },
];
const BUILTIN_NETWORKS = new Set(["bridge", "host", "none", "docker_gwbridge", "ingress"]);

const state = {
  mode: "sidebar",
  view: "containers",
  conn: { status: "connecting", version: "", context: "", message: "" },
  startingSince: 0,
  containers: [],
  images: [],
  volumes: [],
  networks: [],
  stats: {},
  df: [],
  loaded: { containers: false, images: false, volumes: false, networks: false },
  errors: {},
  filters: {},
  runningOnly: false,
  logTimestamps: false,
  collapsed: new Set(),
  busy: new Map(),
  detail: null,
};

const isOk = () => state.conn.status === "ok";
const isUp = (c) => c.state === "running" || c.state === "restarting" || c.state === "paused";
const findContainer = (id) => state.containers.find((c) => c.id === id);
const filterText = () => (state.filters[state.view] || "").trim().toLowerCase();

// ---------------------------------------------------------------- prefs

const PREFS_KEY = "prefs";

async function loadPrefs() {
  try {
    const p = await mx().storage.get(PREFS_KEY);
    if (p && typeof p === "object") {
      if (VIEWS.some((v) => v.id === p.view)) state.view = p.view;
      state.runningOnly = !!p.runningOnly;
      state.logTimestamps = !!p.logTimestamps;
      if (Array.isArray(p.collapsed)) state.collapsed = new Set(p.collapsed);
    }
  } catch (e) {
    console.warn("[docker] couldn't read saved preferences:", e?.message || e);
  }
}

let prefsTimer = 0;
function savePrefs() {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(async () => {
    try {
      await mx().storage.set(PREFS_KEY, {
        view: state.view,
        runningOnly: state.runningOnly,
        logTimestamps: state.logTimestamps,
        collapsed: [...state.collapsed],
      });
    } catch (e) {
      console.warn("[docker] couldn't save preferences:", e?.message || e);
    }
  }, 400);
}

// ---------------------------------------------------------------- polling

const hasRunning = () => state.containers.some((c) => c.state === "running");

const TASKS = {
  engine: { every: 4000, when: () => state.conn.status === "daemon" || state.conn.status === "starting", run: () => connect() },
  containers: { every: 3000, when: isOk, run: loadContainers },
  images: { every: 10000, when: () => isOk() && state.view === "images", run: loadImages },
  volumes: { every: 10000, when: () => isOk() && state.view === "volumes", run: loadVolumes },
  networks: { every: 15000, when: () => isOk() && state.view === "networks", run: loadNetworks },
  stats: { every: 5000, when: () => isOk() && hasRunning() && (state.view === "containers" || !!state.detail), run: loadStats },
  df: { every: 30000, when: isOk, run: loadDiskUsage },
  inspect: { every: 5000, when: () => isOk() && state.detail?.tab === "info", run: loadInspect },
  logs: { every: 2000, when: () => isOk() && state.detail?.tab === "logs" && state.detail.follow, run: loadLogs },
};
const taskState = Object.fromEntries(Object.keys(TASKS).map((k) => [k, { last: 0, busy: false, dirty: false }]));

function pump() {
  if (document.visibilityState === "hidden") return;
  const now = Date.now();
  for (const [name, task] of Object.entries(TASKS)) {
    const ts = taskState[name];
    if (ts.busy || !task.when()) continue;
    if (now - ts.last >= task.every) runTask(name);
  }
}

async function runTask(name) {
  const ts = taskState[name];
  if (ts.busy) {
    ts.dirty = true;
    return;
  }
  ts.busy = true;
  try {
    await TASKS[name].run();
  } catch (e) {
    onTaskError(name, e);
  } finally {
    ts.busy = false;
    ts.last = ts.dirty ? 0 : Date.now();
    ts.dirty = false;
  }
}

function kick(...names) {
  for (const n of names) {
    const ts = taskState[n];
    if (!ts) continue;
    ts.last = 0;
    if (ts.busy) ts.dirty = true;
  }
  pump();
}

const VIEW_TASK = { containers: "containers", images: "images", volumes: "volumes", networks: "networks" };

let lastTaskError = "";
function onTaskError(name, e) {
  if (e instanceof DockerError && ["daemon", "missing", "exec"].includes(e.kind)) {
    handleConnError(e);
    return;
  }
  const msg = e?.message || String(e);
  if (msg !== lastTaskError) console.warn(`[docker] ${name}: ${msg}`);
  lastTaskError = msg;
  if (name in state.loaded) {
    state.errors[name] = msg;
    if (state.view === name) renderList();
  } else if (name === "inspect" && state.detail) {
    state.detail.inspectError = msg;
    renderDetailBody();
  } else if (name === "logs" && state.detail) {
    state.detail.logsError = msg;
    renderDetailBody();
  }
}

// ---------------------------------------------------------------- connection

let connecting = false;
async function connect() {
  if (connecting) return;
  connecting = true;
  try {
    const version = await api.version();
    let context = "";
    try {
      context = await api.contextName();
    } catch {
      /* context is cosmetic */
    }
    const wasOk = isOk();
    state.conn = { status: "ok", version, context, message: "" };
    if (!wasOk) kick("containers", "df", VIEW_TASK[state.view]);
  } catch (e) {
    handleConnError(e);
  } finally {
    connecting = false;
    renderAll();
  }
}

function handleConnError(e) {
  const kind = e instanceof DockerError ? e.kind : "exec";
  const message = e?.raw || e?.message || String(e);
  if (kind === "daemon" || kind === "timeout") {
    if (state.conn.status === "starting" && Date.now() - state.startingSince < 120000) return;
    state.conn = { ...state.conn, status: "daemon", message };
  } else if (kind === "missing") {
    state.conn = { ...state.conn, status: "missing", message };
  } else {
    state.conn = { ...state.conn, status: "error", message };
  }
  if (state.detail) closeDetail();
  renderAll();
}

function resetData() {
  state.containers = [];
  state.images = [];
  state.volumes = [];
  state.networks = [];
  state.stats = {};
  state.df = [];
  for (const k of Object.keys(state.loaded)) state.loaded[k] = false;
  state.errors = {};
  if (state.detail) closeDetail();
}

function refreshAll() {
  if (isOk()) {
    kick("containers", "df", "stats", VIEW_TASK[state.view]);
    if (state.detail) kick(state.detail.tab === "logs" ? "logs" : "inspect");
    spinRefresh();
  } else {
    if (state.conn.status !== "starting") state.conn = { ...state.conn, status: "connecting" };
    renderAll();
    connect();
  }
}

function spinRefresh() {
  const b = $("#refresh-btn");
  b.classList.remove("spinning");
  void b.offsetWidth;
  b.classList.add("spinning");
}

async function startDesktop() {
  state.conn = { ...state.conn, status: "starting" };
  state.startingSince = Date.now();
  renderAll();
  try {
    const res = await mx().exec(["open", "-a", "Docker"], { timeoutMs: 20000 });
    if (res.exitCode !== 0) throw new Error((res.stderr || "").trim() || "Docker Desktop couldn't be opened");
  } catch (e) {
    state.conn = { ...state.conn, status: "daemon", message: e?.message || String(e) };
    toastError(e, "Couldn't start Docker Desktop");
    renderAll();
    return;
  }
  kick("engine");
}

async function pickContext() {
  let contexts;
  try {
    contexts = await api.contexts();
  } catch (e) {
    toastError(e);
    return;
  }
  let picked;
  try {
    picked = await mx().modal.open({
      placeholder: "Switch Docker context (also changes it for the docker CLI)",
      items: contexts.map((c) => ({
        id: c.name,
        title: c.current ? `${c.name}  ✓` : c.name,
        subtitle: c.error ? `Error: ${c.error}` : c.description || c.endpoint,
      })),
      emptyLabel: "No Docker contexts",
    });
  } catch (e) {
    toastError(e);
    return;
  }
  if (!picked || contexts.find((c) => c.name === picked.id)?.current) return;
  try {
    await api.useContext(picked.id);
  } catch (e) {
    toastError(e, "Couldn't switch context");
    return;
  }
  toast(`Switched to ${picked.id}`);
  resetData();
  state.conn = { status: "connecting", version: "", context: picked.id, message: "" };
  renderAll();
  connect();
}

// ---------------------------------------------------------------- loaders

async function loadContainers() {
  const list = await api.containers();
  state.containers = list;
  state.loaded.containers = true;
  state.errors.containers = null;
  if (state.detail && !list.some((c) => c.id === state.detail.id)) {
    closeDetail(`${state.detail.name} is gone`);
  }
  renderTabs();
  if (state.view === "containers" || state.view === "images") renderList();
  if (state.detail) renderDetailChrome();
}

async function loadImages() {
  state.images = await api.images();
  state.loaded.images = true;
  state.errors.images = null;
  renderTabs();
  if (state.view === "images") renderList();
}

async function loadVolumes() {
  state.volumes = await api.volumes();
  state.loaded.volumes = true;
  state.errors.volumes = null;
  renderTabs();
  if (state.view === "volumes") renderList();
}

async function loadNetworks() {
  state.networks = await api.networks();
  state.loaded.networks = true;
  state.errors.networks = null;
  renderTabs();
  if (state.view === "networks") renderList();
}

async function loadStats() {
  state.stats = await api.stats();
  applyStats();
  if (state.detail?.tab === "info") renderDetailBody();
}

async function loadDiskUsage() {
  state.df = await api.diskUsage();
  renderFooter();
}

async function loadInspect() {
  const d = state.detail;
  if (!d) return;
  const id = d.id;
  const data = await api.inspect(id);
  if (state.detail?.id !== id) return;
  state.detail.inspect = data;
  state.detail.inspectError = null;
  renderDetailBody();
}

async function loadLogs() {
  const d = state.detail;
  if (!d) return;
  const id = d.id;
  const lines = await api.logs(id, 400);
  if (state.detail?.id !== id) return;
  state.detail.logs = lines;
  state.detail.logsError = null;
  renderDetailBody();
}

// ---------------------------------------------------------------- toasts

function toast(text, { kind = "ok", timeout = 3200, action = null, sticky = false } = {}) {
  const host = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  const lead = sticky ? '<span class="spin"></span>' : icon(kind === "error" ? "alert" : "check");
  el.innerHTML = `${lead}<span class="toast-text">${esc(text)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ""}`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add("out");
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener("click", (e) => {
    if (action && e.target.closest(".toast-action")) action.run();
    close();
  });
  host.append(el);
  while (host.children.length > 4) host.firstElementChild.remove();
  if (!sticky && timeout) setTimeout(close, timeout);
  return { close };
}

function toastError(e, prefix = "") {
  const msg = e?.message || String(e);
  console.warn("[docker]", prefix ? `${prefix}: ${msg}` : msg);
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

// ---------------------------------------------------------------- dialogs

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
    if (e instanceof DockerError && e.kind === "daemon") handleConnError(e);
    else toastError(e);
    return false;
  } finally {
    state.busy.delete(key);
    renderBusy();
  }
}

function renderBusy() {
  renderList();
  renderToolbar();
  if (state.detail) renderDetailChrome();
}

// ---------------------------------------------------------------- menu

let menuItems = null;

function openMenu(items, anchor) {
  if (!items || !items.length) return;
  const el = $("#menu");
  menuItems = items;
  el.innerHTML = items
    .map((it, i) =>
      it === "-"
        ? '<div class="menu-sep"></div>'
        : `<button class="menu-item${it.danger ? " danger" : ""}" data-menu="${i}"${it.disabled ? " disabled" : ""}>${icon(it.icon || "")}<span>${esc(it.label)}</span></button>`
    )
    .join("");
  el.hidden = false;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x;
  let y;
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    x = r.right - w;
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

function containerMenu(c) {
  const up = isUp(c);
  return [
    { label: "Details", icon: "info", run: () => openDetail(c.id, "info") },
    { label: "Logs", icon: "logs", run: () => openDetail(c.id, "logs") },
    { label: "Logs in Terminal", icon: "external", run: () => openTerminal(logsCommand(c)) },
    { label: "Open Shell", icon: "terminal", disabled: c.state !== "running", run: () => openTerminal(shellCommand(c)) },
    "-",
    up ? { label: "Stop", icon: "stop", run: () => containerVerb(c.id, "stop") } : { label: "Start", icon: "play", run: () => containerVerb(c.id, "start") },
    { label: "Restart", icon: "restart", run: () => containerVerb(c.id, "restart") },
    c.state === "paused"
      ? { label: "Resume", icon: "play", run: () => containerVerb(c.id, "unpause") }
      : { label: "Pause", icon: "pause", disabled: c.state !== "running", run: () => containerVerb(c.id, "pause") },
    "-",
    ...parsePorts(c.ports)
      .filter((p) => p.proto === "tcp")
      .slice(0, 4)
      .map((p) => ({ label: `Open ${portUrl(p).replace(/^https?:\/\//, "")}`, icon: "globe", run: () => openUrl(portUrl(p)) })),
    { label: "Copy Name", icon: "copy", run: () => copyText(c.name, "Name copied") },
    { label: "Copy ID", icon: "copy", run: () => copyText(c.id, "ID copied") },
    "-",
    { label: "Remove…", icon: "trash", danger: true, run: () => removeContainer(c.id) },
  ];
}

function composeMenu(project) {
  const members = state.containers.filter((c) => c.project === project);
  const meta = members.find((c) => c.configFiles) || members[0] || {};
  const anyUp = members.some(isUp);
  return [
    { label: "Up (create & start)", icon: "up", disabled: !meta.configFiles, run: () => composeVerb(project, "up") },
    anyUp ? { label: "Stop", icon: "stop", run: () => composeVerb(project, "stop") } : { label: "Start", icon: "play", run: () => composeVerb(project, "start") },
    { label: "Restart", icon: "restart", run: () => composeVerb(project, "restart") },
    { label: "Logs in Terminal", icon: "external", run: () => openTerminal(`docker compose -p ${shq(project)} logs -f --tail 100`) },
    "-",
    { label: "Copy Project Folder", icon: "copy", disabled: !meta.workingDir, run: () => copyText(meta.workingDir, "Folder copied") },
    "-",
    { label: "Down (remove containers)…", icon: "down", danger: true, run: () => composeVerb(project, "down") },
  ];
}

function imageMenu(img) {
  const ref = imageRef(img);
  const tagged = img.repo !== "<none>" && img.tag !== "<none>";
  return [
    { label: "Run…", icon: "play", run: () => runImage(ref) },
    { label: "Pull Latest", icon: "download", disabled: !tagged, run: () => pullImage(ref) },
    "-",
    { label: "Copy Name", icon: "copy", disabled: !tagged, run: () => copyText(ref, "Name copied") },
    { label: "Copy ID", icon: "copy", run: () => copyText(img.id, "ID copied") },
    "-",
    { label: "Remove…", icon: "trash", danger: true, run: () => removeImage(ref) },
  ];
}

function volumeMenu(v) {
  return [
    { label: "Copy Name", icon: "copy", run: () => copyText(v.name, "Name copied") },
    { label: "Copy Mountpoint", icon: "copy", disabled: !v.mountpoint, run: () => copyText(v.mountpoint, "Mountpoint copied") },
    "-",
    { label: v.inUse ? "Remove (in use)" : "Remove…", icon: "trash", danger: true, disabled: v.inUse, run: () => removeVolume(v.name) },
  ];
}

function networkMenu(n) {
  return [
    { label: "Copy Name", icon: "copy", run: () => copyText(n.name, "Name copied") },
    { label: "Copy ID", icon: "copy", run: () => copyText(n.id, "ID copied") },
    "-",
    { label: "Remove…", icon: "trash", danger: true, disabled: BUILTIN_NETWORKS.has(n.name), run: () => removeNetwork(n.id) },
  ];
}

function menuFor(el) {
  const { ctx } = el.dataset;
  if (ctx === "container") {
    const c = findContainer(el.dataset.id);
    return c && containerMenu(c);
  }
  if (ctx === "compose") return composeMenu(el.dataset.project);
  if (ctx === "image") {
    const img = state.images.find((i) => imageRef(i) === el.dataset.ref);
    return img && imageMenu(img);
  }
  if (ctx === "volume") {
    const v = state.volumes.find((x) => x.name === el.dataset.name);
    return v && volumeMenu(v);
  }
  if (ctx === "network") {
    const n = state.networks.find((x) => x.id === el.dataset.id);
    return n && networkMenu(n);
  }
  return null;
}

function appMenu() {
  return [
    { label: "Switch Context…", icon: "server", disabled: state.conn.status === "missing", run: pickContext },
    { label: "Clean Up Docker…", icon: "eraser", disabled: !isOk(), run: cleanUp },
    "-",
    ...(isMac && !isOk() ? [{ label: "Start Docker Desktop", icon: "power", run: startDesktop }] : []),
    { label: "Refresh", icon: "refresh", run: refreshAll },
  ];
}

// ---------------------------------------------------------------- actions

const shellCommand = (c) => `docker exec -it ${shq(c.name)} sh -c ${shq("command -v bash >/dev/null 2>&1 && exec bash || exec sh")}`;
const logsCommand = (c) => `docker logs -f --tail 200 ${shq(c.name)}`;

async function openTerminal(command) {
  try {
    await mx().tabs.open({ kind: "terminal", command });
  } catch (e) {
    toastError(e, "Couldn't open a terminal");
  }
}

async function openUrl(url) {
  try {
    await mx().tabs.open({ kind: "browser", url });
  } catch (e) {
    toastError(e, "Couldn't open a browser tab");
  }
}

const VERBS = {
  start: ["Starting", "Started"],
  stop: ["Stopping", "Stopped"],
  restart: ["Restarting", "Restarted"],
  pause: ["Pausing", "Paused"],
  unpause: ["Resuming", "Resumed"],
};

async function containerVerb(id, verb) {
  const c = findContainer(id);
  if (!c) return;
  const [ing, ed] = VERBS[verb];
  const ok = await busy(`c:${c.id}`, ing, () => api.container(verb, c.id));
  if (ok) toast(`${ed} ${c.name}`);
  kick("containers", "stats");
  if (state.detail?.id === c.id) kick(state.detail.tab === "logs" ? "logs" : "inspect");
}

async function removeContainer(id) {
  const c = findContainer(id);
  if (!c) return;
  const running = isUp(c);
  const choice = await confirm({
    title: `Remove ${c.name}?`,
    message: running
      ? "The container is running. It will be stopped and removed. Named volumes are kept."
      : "The container is removed. Named volumes are kept.",
    buttons: ["Remove", "Cancel"],
    default: "Remove",
    cancel: "Cancel",
  });
  if (choice !== "Remove") return;
  const ok = await busy(`c:${c.id}`, "Removing", () => api.container("rm", c.id, running ? ["-f"] : []));
  if (ok) {
    toast(`Removed ${c.name}`);
    if (state.detail?.id === c.id) closeDetail();
  }
  kick("containers", "df");
}

const COMPOSE_VERBS = {
  up: ["Starting", "Started"],
  start: ["Starting", "Started"],
  stop: ["Stopping", "Stopped"],
  restart: ["Restarting", "Restarted"],
  down: ["Taking down", "Took down"],
};

async function composeVerb(project, verb) {
  const members = state.containers.filter((c) => c.project === project);
  const meta = members.find((c) => c.configFiles) || members[0] || {};
  if (verb === "down") {
    const choice = await confirm({
      title: `Take down ${project}?`,
      message: "Stops and removes this project's containers and networks. Volumes and images are kept.",
      buttons: ["Down", "Cancel"],
      default: "Cancel",
      cancel: "Cancel",
    });
    if (choice !== "Down") return;
  }
  const [ing, ed] = COMPOSE_VERBS[verb];
  const ok = await busy(`compose:${project}`, ing, () => api.compose(project, verb, meta));
  if (ok) toast(`${ed} ${project}`);
  kick("containers", "stats", "df");
}

function imageRef(img) {
  return img.repo !== "<none>" && img.tag !== "<none>" ? `${img.repo}:${img.tag}` : img.id;
}

function imageUsers(img) {
  const ref = imageRef(img);
  return state.containers.filter(
    (c) => c.image === ref || c.image === img.id || (img.tag === "latest" && c.image === img.repo)
  );
}

async function runImage(ref) {
  const input = await prompt({
    title: `Run ${ref}`,
    placeholder: "Options, e.g. -p 8080:80 --name web (add -- cmd to override)",
  });
  if (input == null) return;
  const parts = splitArgs(input);
  const dd = parts.indexOf("--");
  const options = dd >= 0 ? parts.slice(0, dd) : parts;
  const command = dd >= 0 ? parts.slice(dd + 1) : [];
  let newId = "";
  const ok = await busy(`img:${ref}`, "Starting", async () => {
    newId = (await api.runImage(ref, options, command)).trim().split("\n").pop().slice(0, 12);
  });
  kick("containers");
  if (ok) {
    toast(`Started a container from ${ref}`, {
      action: { label: "Show", run: () => showContainerSoon(newId) },
    });
  }
}

function showContainerSoon(id) {
  setView("containers");
  const tryOpen = (n) => {
    if (findContainer(id)) openDetail(id, "logs");
    else if (n > 0) setTimeout(() => tryOpen(n - 1), 500);
  };
  tryOpen(8);
}

async function pullImage(ref) {
  if (!ref) {
    const input = await prompt({ title: "Pull an image", placeholder: "nginx:latest" });
    ref = (input || "").trim();
    if (!ref) return;
  }
  const t = toast(`Pulling ${ref}…`, { sticky: true });
  const ok = await busy(`pull:${ref}`, "Pulling", () => api.pull(ref));
  t.close();
  if (ok) toast(`Pulled ${ref}`);
  kick("images", "df");
}

async function removeImage(ref) {
  const img = state.images.find((i) => imageRef(i) === ref);
  if (!img) return;
  const users = imageUsers(img);
  const choice = await confirm({
    title: `Remove ${ref}?`,
    message: users.length
      ? `Used by ${plural(users.length, "container")} (${users.map((c) => c.name).join(", ")}). Removing it anyway only untags it while they exist.`
      : "The image is deleted from this machine.",
    buttons: ["Remove", "Cancel"],
    default: users.length ? "Cancel" : "Remove",
    cancel: "Cancel",
  });
  if (choice !== "Remove") return;
  const key = `img:${ref}`;
  try {
    state.busy.set(key, "Removing");
    renderBusy();
    await api.removeImage(ref, users.length > 0);
    toast(`Removed ${ref}`);
  } catch (e) {
    if (/must be forced|being used|conflict/i.test(e?.message || "")) {
      state.busy.delete(key);
      renderBusy();
      const force = await confirm({
        title: `Force remove ${ref}?`,
        message: e.message,
        buttons: ["Force Remove", "Cancel"],
        default: "Cancel",
        cancel: "Cancel",
      });
      if (force === "Force Remove") {
        const ok = await busy(key, "Removing", () => api.removeImage(ref, true));
        if (ok) toast(`Removed ${ref}`);
      }
    } else {
      toastError(e);
    }
  } finally {
    state.busy.delete(key);
    renderBusy();
  }
  kick("images", "df");
}

async function removeVolume(name) {
  const choice = await confirm({
    title: "Remove volume?",
    message: `${name}\n\nIts data is deleted permanently.`,
    buttons: ["Remove", "Cancel"],
    default: "Cancel",
    cancel: "Cancel",
  });
  if (choice !== "Remove") return;
  const ok = await busy(`vol:${name}`, "Removing", () => api.removeVolume(name));
  if (ok) toast("Volume removed");
  kick("volumes", "df");
}

async function removeNetwork(id) {
  const n = state.networks.find((x) => x.id === id);
  if (!n) return;
  const choice = await confirm({
    title: `Remove network ${n.name}?`,
    message: "Containers must be disconnected from it first.",
    buttons: ["Remove", "Cancel"],
    default: "Remove",
    cancel: "Cancel",
  });
  if (choice !== "Remove") return;
  const ok = await busy(`net:${id}`, "Removing", () => api.removeNetwork(id));
  if (ok) toast(`Removed ${n.name}`);
  kick("networks");
}

function reclaimed(out) {
  const m = /Total reclaimed space:\s*(.+)/i.exec(out || "");
  return m ? m[1].trim() : "";
}

async function pruneView() {
  const v = state.view;
  let choice;
  let opts = {};
  if (v === "containers") {
    choice = await confirm({
      title: "Remove all stopped containers?",
      message: "Running containers are left alone.",
      buttons: ["Remove Stopped", "Cancel"],
      default: "Cancel",
      cancel: "Cancel",
    });
    if (choice !== "Remove Stopped") return;
  } else if (v === "images") {
    choice = await confirm({
      title: "Remove unused images?",
      message: "Dangling images are untagged leftovers. All unused also removes tagged images no container uses.",
      buttons: ["Dangling Only", "All Unused", "Cancel"],
      default: "Dangling Only",
      cancel: "Cancel",
    });
    if (!choice || choice === "Cancel") return;
    opts = { all: choice === "All Unused" };
  } else if (v === "volumes") {
    choice = await confirm({
      title: "Remove unused volumes?",
      message: "Their data is deleted permanently. Anonymous only keeps named volumes.",
      buttons: ["Anonymous Only", "All Unused", "Cancel"],
      default: "Cancel",
      cancel: "Cancel",
    });
    if (!choice || choice === "Cancel") return;
    opts = { all: choice === "All Unused" };
  } else {
    choice = await confirm({
      title: "Remove unused networks?",
      message: "Networks no container is connected to are removed. Built-in networks stay.",
      buttons: ["Remove Unused", "Cancel"],
      default: "Cancel",
      cancel: "Cancel",
    });
    if (choice !== "Remove Unused") return;
  }
  const kind = { containers: "container", images: "image", volumes: "volume", networks: "network" }[v];
  let out = "";
  const ok = await busy(`prune:${v}`, "Cleaning", async () => {
    out = await api.prune(kind, opts);
  });
  if (ok) toast(reclaimed(out) ? `Reclaimed ${reclaimed(out)}` : "Cleaned up");
  kick(VIEW_TASK[v], "containers", "df");
}

async function cleanUp() {
  const choice = await confirm({
    title: "Clean up Docker?",
    message:
      "Removes stopped containers, unused networks, dangling images, and build cache. Volumes are kept.\n\nInclude unused images also removes tagged images no container uses.",
    buttons: ["Clean Up", "Include Unused Images", "Cancel"],
    default: "Cancel",
    cancel: "Cancel",
  });
  if (!choice || choice === "Cancel") return;
  let out = "";
  const ok = await busy("prune:system", "Cleaning", async () => {
    out = await api.prune("system", { all: choice === "Include Unused Images" });
  });
  if (ok) toast(reclaimed(out) ? `Reclaimed ${reclaimed(out)}` : "Cleaned up");
  kick("containers", "images", "volumes", "networks", "df");
}

// ---------------------------------------------------------------- views

function setView(v) {
  if (!VIEWS.some((x) => x.id === v) || v === state.view) {
    if (state.detail) closeDetail();
    return;
  }
  state.view = v;
  savePrefs();
  closeMenu();
  if (state.detail) closeDetail();
  const input = $("#filter");
  input.value = state.filters[v] || "";
  syncClear();
  $("#list").scrollTop = 0;
  renderAll();
  kick(VIEW_TASK[v]);
}

function renderAll() {
  document.body.classList.toggle("connected", isOk());
  renderHeader();
  renderTabs();
  renderToolbar();
  renderList();
  renderFooter();
  if (state.detail) {
    renderDetailChrome();
    renderDetailBody();
  }
}

function renderHeader() {
  const pill = $("#engine");
  const s = state.conn.status;
  const tone = s === "ok" ? "ok" : s === "connecting" || s === "starting" ? "pending" : "bad";
  const text =
    s === "ok"
      ? [state.conn.context, state.conn.version].filter(Boolean).join(" · ") || "Connected"
      : { connecting: "Connecting…", starting: "Starting…", missing: "Not installed", error: "Unavailable", daemon: "Not running" }[s];
  pill.className = `engine-pill ${tone}`;
  pill.querySelector(".engine-text").textContent = text;
  pill.title =
    s === "ok"
      ? `Docker Engine ${state.conn.version}${state.conn.context ? `, context “${state.conn.context}”` : ""}. Click to switch context.`
      : "Switch Docker context";
  pill.disabled = s === "missing";
}

function renderTabs() {
  const counts = {
    containers: state.loaded.containers ? state.containers.filter((c) => c.state === "running").length : null,
    images: state.loaded.images ? state.images.length : null,
    volumes: state.loaded.volumes ? state.volumes.length : null,
    networks: state.loaded.networks ? state.networks.length : null,
  };
  const html = VIEWS.map((v) => {
    const n = counts[v.id];
    const live = v.id === "containers" && n > 0;
    return `<button class="tab${state.view === v.id ? " active" : ""}" role="tab" aria-selected="${state.view === v.id}" data-action="tab" data-view="${v.id}" title="${esc(
      v.id === "containers" && n != null ? `${n} running of ${state.containers.length}` : v.label
    )}"><span class="tab-label">${v.label}</span>${n != null && n > 0 ? `<span class="tab-count${live ? " live" : ""}">${n}</span>` : ""}</button>`;
  }).join("");
  setHtml($("#tabs"), html);
}

function renderToolbar() {
  const v = state.view;
  const noun = VIEWS.find((x) => x.id === v).noun;
  $("#filter").placeholder = `Filter ${noun}`;
  const pruneBusy = state.busy.get(`prune:${v}`);
  const prune = pruneBusy ? spinner(pruneBusy) : null;
  let html = "";
  if (v === "containers") {
    html =
      `<button class="chip${state.runningOnly ? " on" : ""}" data-action="toggle-running" aria-pressed="${state.runningOnly}" title="Show only running containers">Running</button>` +
      (prune || btn("eraser", "prune", "Remove stopped containers…"));
  } else if (v === "images") {
    const pulling = [...state.busy.keys()].some((k) => k.startsWith("pull:"));
    html = (pulling ? spinner("Pulling") : btn("download", "pull", "Pull an image…")) + (prune || btn("eraser", "prune", "Remove unused images…"));
  } else if (v === "volumes") {
    html = prune || btn("eraser", "prune", "Remove unused volumes…");
  } else {
    html = prune || btn("eraser", "prune", "Remove unused networks…");
  }
  setHtml($("#toolbar-actions"), html);
}

function setHtml(el, html) {
  if (el._html === html) return false;
  el.innerHTML = html;
  el._html = html;
  return true;
}

function renderList() {
  const el = $("#list");
  let html;
  if (!isOk()) html = connHtml();
  else if (state.view === "containers") html = containersHtml();
  else if (state.view === "images") html = imagesHtml();
  else if (state.view === "volumes") html = volumesHtml();
  else html = networksHtml();
  if (setHtml(el, html)) applyStats();
}

function stateScreen({ ic, spin, title, text, detail, buttons = [] }) {
  return `<div class="state">
    <div class="state-icon">${spin ? '<span class="spin big"></span>' : icon(ic)}</div>
    <div class="state-title">${esc(title)}</div>
    ${text ? `<div class="state-text">${esc(text)}</div>` : ""}
    ${detail ? `<div class="state-detail">${esc(detail)}</div>` : ""}
    ${buttons.length ? `<div class="state-buttons">${buttons.map((b) => `<button class="button${b.primary ? " primary" : ""}" data-action="${b.action}">${esc(b.label)}</button>`).join("")}</div>` : ""}
  </div>`;
}

function connHtml() {
  const s = state.conn.status;
  if (s === "connecting") {
    return stateScreen({
      spin: true,
      title: "Connecting to Docker…",
      text: "If Muxy asks to run docker, choose Allow & Remember so the sidebar can keep itself up to date.",
    });
  }
  if (s === "starting") {
    return stateScreen({ spin: true, title: "Starting Docker Desktop…", text: "This can take a minute. The sidebar connects as soon as the engine is up." });
  }
  if (s === "daemon") {
    return stateScreen({
      ic: "power",
      title: "Docker isn't running",
      text: "Start Docker Desktop or your Docker engine. The sidebar reconnects on its own.",
      detail: state.conn.message,
      buttons: [...(isMac ? [{ action: "start-desktop", label: "Start Docker Desktop", primary: true }] : []), { action: "retry", label: "Retry" }],
    });
  }
  if (s === "missing") {
    return stateScreen({
      ic: "alert",
      title: "Docker isn't installed",
      text: "Install Docker Desktop, or make sure docker is on your login shell's PATH.",
      detail: state.conn.message,
      buttons: [{ action: "retry", label: "Try Again", primary: true }],
    });
  }
  return stateScreen({
    ic: "alert",
    title: "Couldn't run docker",
    text: "Muxy needs your permission to run the docker command for this extension.",
    detail: state.conn.message,
    buttons: [{ action: "retry", label: "Try Again", primary: true }],
  });
}

const loadingHtml = (text = "Loading…") => `<div class="loading"><span class="spin"></span>${esc(text)}</div>`;

function errorHtml(msg) {
  return `<div class="inline-error">${icon("alert")}<div><div>${esc(msg)}</div><button class="link" data-action="refresh">Try again</button></div></div>`;
}

function emptyHtml(ic, title, text) {
  return `<div class="empty">${icon(ic)}<div class="empty-title">${esc(title)}</div>${text ? `<div class="empty-text">${esc(text)}</div>` : ""}</div>`;
}

function listPreamble(view) {
  if (state.errors[view] && !state.loaded[view]) return errorHtml(state.errors[view]);
  if (!state.loaded[view]) return loadingHtml();
  return null;
}

// ----- containers

function dotClass(c) {
  if (c.state === "running") {
    if (/\(unhealthy\)/.test(c.status)) return "bad";
    if (/health: starting/.test(c.status)) return "warn";
    return "ok";
  }
  if (c.state === "paused" || c.state === "restarting") return "warn";
  if (c.state === "dead") return "bad";
  if (c.state === "exited") {
    const m = /Exited \((\d+)\)/.exec(c.status);
    return m && m[1] !== "0" && m[1] !== "137" && m[1] !== "143" ? "bad" : "off";
  }
  return "off";
}

function statusText(c) {
  return String(c.status || c.state || "")
    .replace(/\s*\((?:healthy|unhealthy|health: starting)\)/, "")
    .trim();
}

function healthBadge(c) {
  const m = /\((healthy|unhealthy|health: starting)\)/.exec(c.status || "");
  if (!m) return "";
  const label = m[1] === "health: starting" ? "starting" : m[1];
  const tone = m[1] === "healthy" ? "ok" : m[1] === "unhealthy" ? "bad" : "warn";
  return `<span class="badge ${tone}">${label}</span>`;
}

function portChips(c, max = 2) {
  const ports = parsePorts(c.ports).filter((p) => p.proto === "tcp");
  if (!ports.length || !isUp(c)) return "";
  const shown = ports.slice(0, max);
  const more = ports.length - shown.length;
  return `<span class="ports">${shown
    .map((p) => `<button class="port" data-action="port" data-url="${esc(portUrl(p))}" title="Open ${esc(portUrl(p))} → ${p.containerPort}/${p.proto}">:${p.hostPort}</button>`)
    .join("")}${more > 0 ? `<span class="port more" title="${esc(ports.slice(max).map((p) => p.hostPort).join(", "))}">+${more}</span>` : ""}</span>`;
}

function containerRow(c, inGroup) {
  const busyLabel = state.busy.get(`c:${c.id}`);
  const title = inGroup && c.service ? c.service : c.name;
  const up = isUp(c);
  const running = c.state === "running";
  const sub = [c.image, statusText(c)].filter(Boolean).join(" · ");
  const actions = busyLabel
    ? spinner(busyLabel)
    : [
        up ? btn("stop", "c-stop", "Stop", { id: c.id }) : btn("play", "c-start", "Start", { id: c.id }),
        running ? btn("terminal", "c-shell", "Open shell", { id: c.id }) : "",
        btn("logs", "c-logs", "Logs", { id: c.id }),
        btn("more", "menu", "More", { ctx: "container", id: c.id }),
      ].join("");
  return `<div class="row c-row${inGroup ? " nested" : ""}${busyLabel ? " busy" : ""}${up ? "" : " stopped"}" data-action="open" data-ctx="container" data-id="${esc(c.id)}" title="${esc(c.name)}" tabindex="0">
    <span class="dot ${dotClass(c)}"></span>
    <div class="row-main">
      <div class="line1"><span class="name">${esc(title)}</span>${healthBadge(c)}${portChips(c)}</div>
      <div class="line2"><span class="sub">${esc(sub)}</span>${running ? `<span class="stat" data-stat="${esc(c.id)}"></span>` : ""}</div>
    </div>
    <div class="row-actions">${actions}</div>
  </div>`;
}

const stateRank = (c) => (c.state === "running" ? 0 : isUp(c) ? 1 : 2);

function containersHtml() {
  const pre = listPreamble("containers");
  if (pre) return pre;
  const all = state.containers;
  if (!all.length) {
    return emptyHtml("box", "No containers", "Run an image from the Images tab, or start a Compose project in a terminal.");
  }
  const q = filterText();
  const matches = (c) => !q || [c.name, c.image, c.project, c.service, c.ports, c.id, c.status].some((v) => v && String(v).toLowerCase().includes(q));
  const visible = all.filter((c) => (!state.runningOnly || isUp(c)) && matches(c));
  if (!visible.length) {
    return emptyHtml(
      "search",
      state.runningOnly && !q ? "Nothing is running" : "No matches",
      state.runningOnly ? "Turn off Running to see stopped containers." : "Try a different filter."
    );
  }
  const groups = new Map();
  const standalone = [];
  for (const c of visible) {
    if (c.project) {
      if (!groups.has(c.project)) groups.set(c.project, []);
      groups.get(c.project).push(c);
    } else {
      standalone.push(c);
    }
  }
  let html = state.errors.containers ? errorHtml(state.errors.containers) : "";
  for (const name of [...groups.keys()].sort(cmp)) {
    html += groupHtml(name, groups.get(name));
  }
  if (standalone.length) {
    if (groups.size) html += `<div class="section-label">Standalone</div>`;
    html += standalone
      .sort((a, b) => stateRank(a) - stateRank(b) || cmp(a.name, b.name))
      .map((c) => containerRow(c, false))
      .join("");
  }
  return html;
}

function groupHtml(project, shown) {
  const members = state.containers.filter((c) => c.project === project);
  const running = members.filter((c) => c.state === "running").length;
  const collapsed = state.collapsed.has(project) && !filterText();
  const busyLabel = state.busy.get(`compose:${project}`);
  const anyUp = members.some(isUp);
  const tone = running === 0 ? "off" : running === members.length ? "ok" : "warn";
  const actions = busyLabel
    ? spinner(busyLabel)
    : [
        anyUp ? btn("stop", "compose-stop", "Stop project", { project }) : btn("play", "compose-start", "Start project", { project }),
        btn("restart", "compose-restart", "Restart project", { project }),
        btn("more", "menu", "More", { ctx: "compose", project }),
      ].join("");
  return `<div class="group${collapsed ? " collapsed" : ""}${busyLabel ? " busy" : ""}">
    <div class="row group-head" data-action="toggle-group" data-ctx="compose" data-project="${esc(project)}" title="${esc(members[0]?.workingDir || project)}" tabindex="0">
      <span class="chev">${icon("chevron")}</span>
      <span class="group-icon">${icon("layers")}</span>
      <span class="group-name">${esc(project)}</span>
      <span class="group-count ${tone}">${running}/${members.length}</span>
      <div class="row-actions">${actions}</div>
    </div>
    <div class="group-body">${shown
      .sort((a, b) => cmp(a.service || a.name, b.service || b.name))
      .map((c) => containerRow(c, true))
      .join("")}</div>
  </div>`;
}

function fmtCpu(s) {
  const n = parseFloat(s);
  if (Number.isNaN(n)) return "";
  return `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;
}

function fmtMem(s) {
  const used = String(s || "").split("/")[0];
  return used ? formatBytes(parseSize(used)) : "";
}

function applyStats() {
  for (const el of document.querySelectorAll("#list [data-stat]")) {
    const s = state.stats[el.dataset.stat];
    const text = s ? `${fmtCpu(s.cpu)} · ${fmtMem(s.mem)}` : "";
    if (el.textContent !== text) el.textContent = text;
    el.title = s ? `CPU ${s.cpu} · Memory ${s.mem}` : "";
  }
}

// ----- images

function imagesHtml() {
  const pre = listPreamble("images");
  if (pre) return pre;
  if (!state.images.length) return emptyHtml("layers", "No images", "Pull one with the download button above.");
  const q = filterText();
  const list = state.images
    .filter((i) => !q || [i.repo, i.tag, i.id].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => (a.repo === "<none>") - (b.repo === "<none>") || cmp(a.repo, b.repo) || cmp(a.tag, b.tag));
  if (!list.length) return emptyHtml("search", "No matches", "Try a different filter.");
  const head = state.errors.images ? errorHtml(state.errors.images) : "";
  return (
    head +
    list
      .map((img) => {
        const ref = imageRef(img);
        const users = imageUsers(img);
        const busyLabel = state.busy.get(`img:${ref}`) || state.busy.get(`pull:${ref}`);
        const dangling = img.repo === "<none>";
        const tagged = !dangling && img.tag !== "<none>";
        const actions = busyLabel
          ? spinner(busyLabel)
          : [btn("play", "img-run", "Run…", { ref }), btn("trash", "img-remove", "Remove…", { ref }), btn("more", "menu", "More", { ctx: "image", ref })].join("");
        return `<div class="row i-row${busyLabel ? " busy" : ""}" data-action="img-menu" data-ctx="image" data-ref="${esc(ref)}" title="${esc(tagged ? ref : img.id)}">
          <span class="row-icon${users.length ? " used" : ""}">${icon("layers")}</span>
          <div class="row-main">
            <div class="line1"><span class="name">${esc(dangling ? "<untagged>" : img.repo)}</span>${tagged ? `<span class="tag">${esc(img.tag)}</span>` : ""}${
          users.length ? `<span class="badge ok" title="${esc(users.map((c) => c.name).join(", "))}">in use</span>` : ""
        }</div>
            <div class="line2"><span class="sub">${esc([img.size, img.created, img.id].filter(Boolean).join(" · "))}</span></div>
          </div>
          <div class="row-actions">${actions}</div>
        </div>`;
      })
      .join("")
  );
}

// ----- volumes

function labelValue(labels, key) {
  for (const part of String(labels || "").split(",")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === key) return part.slice(i + 1);
  }
  return "";
}

function volumesHtml() {
  const pre = listPreamble("volumes");
  if (pre) return pre;
  if (!state.volumes.length) return emptyHtml("database", "No volumes", "Volumes appear here when containers create them.");
  const q = filterText();
  const list = state.volumes
    .filter((v) => !q || [v.name, v.driver, labelValue(v.labels, "com.docker.compose.project")].some((x) => x && x.toLowerCase().includes(q)))
    .sort((a, b) => b.inUse - a.inUse || (/^[0-9a-f]{64}$/.test(a.name) - /^[0-9a-f]{64}$/.test(b.name)) || cmp(a.name, b.name));
  if (!list.length) return emptyHtml("search", "No matches", "Try a different filter.");
  const head = state.errors.volumes ? errorHtml(state.errors.volumes) : "";
  return (
    head +
    list
      .map((v) => {
        const anon = /^[0-9a-f]{64}$/.test(v.name);
        const project = labelValue(v.labels, "com.docker.compose.project");
        const busyLabel = state.busy.get(`vol:${v.name}`);
        const actions = busyLabel
          ? spinner(busyLabel)
          : [
              btn("trash", "vol-remove", v.inUse ? "In use by a container" : "Remove…", { name: v.name }, { disabled: v.inUse }),
              btn("more", "menu", "More", { ctx: "volume", name: v.name }),
            ].join("");
        return `<div class="row v-row${busyLabel ? " busy" : ""}" data-action="vol-menu" data-ctx="volume" data-name="${esc(v.name)}" title="${esc(v.name)}">
          <span class="row-icon${v.inUse ? " used" : ""}">${icon("database")}</span>
          <div class="row-main">
            <div class="line1"><span class="name${anon ? " mono" : ""}">${esc(anon ? `${v.name.slice(0, 12)}…` : v.name)}</span>${
          v.inUse ? '<span class="badge ok">in use</span>' : ""
        }</div>
            <div class="line2"><span class="sub">${esc([anon ? "anonymous" : null, project ? `compose: ${project}` : null, v.driver].filter(Boolean).join(" · "))}</span></div>
          </div>
          <div class="row-actions">${actions}</div>
        </div>`;
      })
      .join("")
  );
}

// ----- networks

function networksHtml() {
  const pre = listPreamble("networks");
  if (pre) return pre;
  const q = filterText();
  const list = state.networks
    .filter((n) => !q || [n.name, n.driver, n.id].some((x) => x && x.toLowerCase().includes(q)))
    .sort((a, b) => BUILTIN_NETWORKS.has(a.name) - BUILTIN_NETWORKS.has(b.name) || cmp(a.name, b.name));
  if (!list.length) return emptyHtml("search", "No matches", "Try a different filter.");
  const head = state.errors.networks ? errorHtml(state.errors.networks) : "";
  return (
    head +
    list
      .map((n) => {
        const builtin = BUILTIN_NETWORKS.has(n.name);
        const busyLabel = state.busy.get(`net:${n.id}`);
        const project = labelValue(n.labels, "com.docker.compose.project");
        const actions = busyLabel
          ? spinner(busyLabel)
          : [
              btn("trash", "net-remove", builtin ? "Built-in networks can't be removed" : "Remove…", { id: n.id }, { disabled: builtin }),
              btn("more", "menu", "More", { ctx: "network", id: n.id }),
            ].join("");
        return `<div class="row n-row${busyLabel ? " busy" : ""}" data-action="net-menu" data-ctx="network" data-id="${esc(n.id)}" title="${esc(n.name)}">
          <span class="row-icon">${icon("network")}</span>
          <div class="row-main">
            <div class="line1"><span class="name">${esc(n.name)}</span>${builtin ? '<span class="badge">built-in</span>' : ""}${n.internal ? '<span class="badge">internal</span>' : ""}</div>
            <div class="line2"><span class="sub">${esc([n.driver, n.scope, project ? `compose: ${project}` : null, n.id].filter(Boolean).join(" · "))}</span></div>
          </div>
          <div class="row-actions">${actions}</div>
        </div>`;
      })
      .join("")
  );
}

// ----- footer

function renderFooter() {
  const el = $("#footer");
  if (!isOk() || !state.df.length) {
    setHtml(el, "");
    el.hidden = true;
    return;
  }
  el.hidden = false;
  let total = 0;
  let recl = 0;
  const lines = [];
  for (const row of state.df) {
    const size = parseSize(row.Size);
    const r = parseSize(row.Reclaimable);
    total += size;
    recl += r;
    lines.push(`${row.Type}: ${formatBytes(size)} (${formatBytes(r)} reclaimable)`);
  }
  const pct = total ? Math.min(100, Math.round((recl / total) * 100)) : 0;
  const busyLabel = state.busy.get("prune:system");
  setHtml(
    el,
    `<div class="disk" title="${esc(lines.join("\n"))}">
      <div class="disk-text"><span class="disk-main">${formatBytes(total)} on disk</span><span class="disk-sub">${formatBytes(recl)} reclaimable</span></div>
      <div class="disk-bar"><span style="width:${pct}%"></span></div>
    </div>
    ${busyLabel ? spinner(busyLabel) : `<button class="text-btn" data-action="clean-up" title="Clean up Docker…">${icon("eraser")}<span>Clean up</span></button>`}`
  );
}

// ---------------------------------------------------------------- detail

function openDetail(id, tab = "info") {
  const c = findContainer(id);
  if (!c) return;
  closeMenu();
  state.detail = { id: c.id, name: c.name, tab, inspect: null, logs: null, follow: true, inspectError: null, logsError: null, showEnv: false, showLabels: false };
  const el = $("#detail");
  el.innerHTML = `<div id="d-chrome"></div><div class="d-body" id="d-body"></div>`;
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
  renderDetailChrome();
  renderDetailBody();
  runTask(tab === "logs" ? "logs" : "inspect");
  kick("stats");
}

function closeDetail(message) {
  state.detail = null;
  const el = $("#detail");
  el.classList.remove("open");
  el.setAttribute("aria-hidden", "true");
  if (message) toast(message);
}

function setDetailTab(tab) {
  const d = state.detail;
  if (!d || d.tab === tab) return;
  d.tab = tab;
  const body = $("#d-body");
  body.scrollTop = 0;
  body._html = "";
  renderDetailChrome();
  renderDetailBody();
  runTask(tab === "logs" ? "logs" : "inspect");
}

function abtn(ic, action, label, id, { disabled = false, cls = "" } = {}) {
  return `<button class="action-btn ${cls}" data-action="${action}" data-id="${esc(id)}" title="${esc(label)}"${disabled ? " disabled" : ""}>${icon(ic)}<span>${esc(label)}</span></button>`;
}

function renderDetailChrome() {
  const d = state.detail;
  const host = $("#d-chrome");
  if (!d || !host) return;
  const c = findContainer(d.id) || { id: d.id, name: d.name, state: "unknown", status: "", image: "" };
  const up = isUp(c);
  const busyLabel = state.busy.get(`c:${d.id}`);
  const sub = [c.project ? `${c.project} / ${c.service}` : null, c.image].filter(Boolean).join(" · ");
  const actions = busyLabel
    ? `<div class="busy-row"><span class="spin"></span>${esc(busyLabel)}…</div>`
    : [
        up ? abtn("stop", "c-stop", "Stop", d.id) : abtn("play", "c-start", "Start", d.id),
        abtn("restart", "c-restart", "Restart", d.id),
        c.state === "paused" ? abtn("play", "c-unpause", "Resume", d.id) : abtn("pause", "c-pause", "Pause", d.id, { disabled: c.state !== "running" }),
        abtn("terminal", "c-shell", "Shell", d.id, { disabled: c.state !== "running" }),
        abtn("trash", "c-remove", "Remove", d.id, { cls: "danger" }),
      ].join("");
  const logBar =
    d.tab === "logs"
      ? `<button class="chip${d.follow ? " on" : ""}" data-action="d-follow" aria-pressed="${d.follow}" title="Keep loading new lines">Follow</button>
         <button class="chip${state.logTimestamps ? " on" : ""}" data-action="d-ts" aria-pressed="${state.logTimestamps}" title="Show timestamps">Time</button>
         ${d.follow ? "" : btn("refresh", "d-reload", "Reload logs")}
         ${btn("copy", "d-copy-logs", "Copy logs")}
         ${btn("external", "c-logs-term", "Follow in a terminal", { id: d.id })}`
      : "";
  setHtml(
    host,
    `<div class="d-head">
      ${btn("back", "d-back", "Back")}
      <span class="dot ${dotClass(c)}"></span>
      <div class="d-title">
        <div class="d-name" title="${esc(c.name)}">${esc(c.name)}${healthBadge(c)}</div>
        <div class="d-sub" title="${esc(sub)}">${esc(statusText(c))}${sub ? ` · ${esc(sub)}` : ""}</div>
      </div>
      ${btn("more", "menu", "More", { ctx: "container", id: d.id })}
    </div>
    <div class="d-actions">${actions}</div>
    <div class="d-tabs">
      <button class="d-tab${d.tab === "info" ? " active" : ""}" data-action="d-tab" data-tab="info">Info</button>
      <button class="d-tab${d.tab === "logs" ? " active" : ""}" data-action="d-tab" data-tab="logs">Logs</button>
      <span class="spacer"></span>
      ${logBar}
    </div>`
  );
}

function renderDetailBody() {
  const d = state.detail;
  const body = $("#d-body");
  if (!d || !body) return;
  // Don't yank a selection out from under the user.
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && body.contains(sel.anchorNode)) return;
  const html = d.tab === "logs" ? logsHtml() : infoHtml();
  if (body._html === html) return;
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 32;
  const firstLogs = d.tab === "logs" && !body.querySelector(".logs");
  body.innerHTML = html;
  body._html = html;
  if (d.tab === "logs" && (atBottom || firstLogs)) body.scrollTop = body.scrollHeight;
}

function logsHtml() {
  const d = state.detail;
  if (d.logsError && !d.logs) return errorHtml(d.logsError);
  if (!d.logs) return loadingHtml("Loading logs…");
  if (!d.logs.length) return `<div class="logs-empty">No log output yet.</div>`;
  return `<div class="logs${state.logTimestamps ? " show-ts" : ""}">${d.logs
    .map((l) => `<div class="ll${l.stream === "err" ? " err" : ""}">${l.ts ? `<span class="ts">${esc(fmtTime(l.ts))}</span>` : ""}${l.text ? esc(l.text) : "&nbsp;"}</div>`)
    .join("")}</div>`;
}

function kv(label, value, { mono = false, copy = null, html = false } = {}) {
  if (value == null || value === "") return "";
  return `<div class="kv"><div class="k">${esc(label)}</div><div class="v${mono ? " mono" : ""}">${html ? value : esc(value)}${
    copy ? `<button class="mini-copy" data-action="copy" data-copy="${esc(copy)}" title="Copy">${icon("copy")}</button>` : ""
  }</div></div>`;
}

function section(title, body, extra = "") {
  if (!body) return "";
  return `<section class="d-section"><h3>${esc(title)}${extra}</h3>${body}</section>`;
}

function infoHtml() {
  const d = state.detail;
  const ins = d.inspect;
  if (!ins) return d.inspectError ? errorHtml(d.inspectError) : loadingHtml("Loading details…");
  const st = ins.State || {};
  const cfg = ins.Config || {};
  const host = ins.HostConfig || {};
  const net = ins.NetworkSettings || {};
  const labels = cfg.Labels || {};
  const stats = state.stats[d.id];

  const health = st.Health?.Status;
  const statusLine = [st.Status, health ? `(${health})` : "", st.Status === "exited" ? `code ${st.ExitCode}` : ""].filter(Boolean).join(" ");
  const restart = host.RestartPolicy?.Name && host.RestartPolicy.Name !== "no" ? host.RestartPolicy.Name : "";
  const cmd = [ins.Path, ...(ins.Args || [])].filter(Boolean).join(" ");

  let html = section(
    "Overview",
    kv("Status", statusLine) +
      kv(st.Running ? "Started" : "Finished", ago(st.Running ? st.StartedAt : st.FinishedAt)) +
      kv("Created", ago(ins.Created)) +
      kv("Image", cfg.Image, { copy: cfg.Image }) +
      kv("ID", String(ins.Id || "").slice(0, 12), { mono: true, copy: ins.Id }) +
      kv("Command", cmd, { mono: true }) +
      kv("Workdir", cfg.WorkingDir, { mono: true }) +
      kv("Restart", restart) +
      kv("Compose", labels["com.docker.compose.project"] ? `${labels["com.docker.compose.project"]} / ${labels["com.docker.compose.service"] || ""}` : "") +
      (st.Error ? kv("Error", st.Error) : "")
  );

  if (st.Running && stats) {
    html += section(
      "Resources",
      kv("CPU", stats.cpu) + kv("Memory", `${stats.mem}${stats.memPerc ? ` (${stats.memPerc})` : ""}`) + kv("Network", stats.net) + kv("Disk I/O", stats.block) + kv("PIDs", stats.pids)
    );
  }

  if (health && st.Health.Log?.length) {
    const last = st.Health.Log[st.Health.Log.length - 1];
    html += section("Last health check", `<pre class="pre">${esc(String(last.Output || "").trim() || `exit ${last.ExitCode}`)}</pre>`);
  }

  const ports = [];
  const seen = new Set();
  for (const [cport, binds] of Object.entries(net.Ports || {})) {
    if (!binds || !binds.length) {
      ports.push(`<div class="port-line muted">${esc(cport)} <span>not published</span></div>`);
      continue;
    }
    for (const b of binds) {
      const key = `${b.HostPort}/${cport}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [cp, proto] = cport.split("/");
      const p = { ip: b.HostIp || "", hostPort: Number(b.HostPort), containerPort: Number(cp), proto };
      ports.push(
        proto === "tcp"
          ? `<button class="port-line link" data-action="port" data-url="${esc(portUrl(p))}">${icon("globe")}<span>${esc(portUrl(p).replace(/^https?:\/\//, ""))}</span><span class="muted">→ ${esc(cport)}</span></button>`
          : `<div class="port-line">${esc(`${b.HostPort} → ${cport}`)}</div>`
      );
    }
  }
  html += section("Ports", ports.join(""));

  const nets = Object.entries(net.Networks || {}).map(([name, n]) => kv(name, n.IPAddress || "no address", { mono: true }));
  html += section("Networks", nets.join(""));

  const mounts = (ins.Mounts || []).map(
    (m) =>
      `<div class="mount"><div class="mount-src mono" title="${esc(m.Source)}">${esc(m.Type === "volume" ? m.Name : m.Source)}</div><div class="mount-dst mono">→ ${esc(m.Destination)}${
        m.RW === false ? ' <span class="badge">read-only</span>' : ""
      } <span class="badge">${esc(m.Type)}</span></div></div>`
  );
  html += section("Mounts", mounts.join(""));

  const env = cfg.Env || [];
  if (env.length) {
    html += section(
      "Environment",
      d.showEnv
        ? env
            .map((e) => {
              const i = e.indexOf("=");
              return kv(i > 0 ? e.slice(0, i) : e, i > 0 ? e.slice(i + 1) : "", { mono: true });
            })
            .join("")
        : "",
      ` <button class="link small" data-action="d-toggle" data-what="showEnv">${d.showEnv ? "Hide" : `Show ${env.length}`}</button>`
    ) || `<section class="d-section"><h3>Environment <button class="link small" data-action="d-toggle" data-what="showEnv">Show ${env.length}</button></h3></section>`;
  }

  const labelEntries = Object.entries(labels);
  if (labelEntries.length) {
    html += d.showLabels
      ? section(
          "Labels",
          labelEntries
            .sort(([a], [b]) => cmp(a, b))
            .map(([k, v]) => kv(k, v, { mono: true }))
            .join(""),
          ` <button class="link small" data-action="d-toggle" data-what="showLabels">Hide</button>`
        )
      : `<section class="d-section"><h3>Labels <button class="link small" data-action="d-toggle" data-what="showLabels">Show ${labelEntries.length}</button></h3></section>`;
  }
  return html;
}

// ---------------------------------------------------------------- events

function syncClear() {
  $(".search-clear").hidden = !$("#filter").value;
}

function handleAction(action, el) {
  const id = el.dataset.id;
  switch (action) {
    case "refresh":
    case "retry":
      return refreshAll();
    case "app-menu":
      return openMenu(appMenu(), el);
    case "context":
      return pickContext();
    case "start-desktop":
      return startDesktop();
    case "tab":
      return setView(el.dataset.view);
    case "clear-filter":
      $("#filter").value = "";
      state.filters[state.view] = "";
      syncClear();
      return renderList();
    case "toggle-running":
      state.runningOnly = !state.runningOnly;
      savePrefs();
      renderToolbar();
      return renderList();
    case "prune":
      return pruneView();
    case "pull":
      return pullImage();
    case "clean-up":
      return cleanUp();
    case "menu":
      return openMenu(menuFor(el), el);
    case "toggle-group": {
      const p = el.dataset.project;
      if (state.collapsed.has(p)) state.collapsed.delete(p);
      else state.collapsed.add(p);
      savePrefs();
      return renderList();
    }
    case "open":
      return openDetail(id, "info");
    case "c-start":
      return containerVerb(id, "start");
    case "c-stop":
      return containerVerb(id, "stop");
    case "c-restart":
      return containerVerb(id, "restart");
    case "c-pause":
      return containerVerb(id, "pause");
    case "c-unpause":
      return containerVerb(id, "unpause");
    case "c-remove":
      return removeContainer(id);
    case "c-logs":
      return openDetail(id, "logs");
    case "c-shell": {
      const c = findContainer(id);
      return c && openTerminal(shellCommand(c));
    }
    case "c-logs-term": {
      const c = findContainer(id);
      return c && openTerminal(logsCommand(c));
    }
    case "port":
      return openUrl(el.dataset.url);
    case "compose-start":
      return composeVerb(el.dataset.project, "start");
    case "compose-stop":
      return composeVerb(el.dataset.project, "stop");
    case "compose-restart":
      return composeVerb(el.dataset.project, "restart");
    case "img-run":
      return runImage(el.dataset.ref);
    case "img-remove":
      return removeImage(el.dataset.ref);
    case "img-menu":
    case "vol-menu":
    case "net-menu":
      return openMenu(menuFor(el), el.querySelector('[data-action="menu"]') || el);
    case "vol-remove":
      return removeVolume(el.dataset.name);
    case "net-remove":
      return removeNetwork(id);
    case "copy":
      return copyText(el.dataset.copy);
    case "d-back":
      return closeDetail();
    case "d-tab":
      return setDetailTab(el.dataset.tab);
    case "d-follow":
      state.detail.follow = !state.detail.follow;
      renderDetailChrome();
      if (state.detail.follow) kick("logs");
      return;
    case "d-ts":
      state.logTimestamps = !state.logTimestamps;
      savePrefs();
      renderDetailChrome();
      return renderDetailBody();
    case "d-reload":
      return runTask("logs");
    case "d-copy-logs": {
      const lines = state.detail?.logs || [];
      return copyText(lines.map((l) => (state.logTimestamps && l.ts ? `${l.ts} ${l.text}` : l.text)).join("\n"), "Logs copied");
    }
    case "d-toggle": {
      const what = el.dataset.what;
      state.detail[what] = !state.detail[what];
      return renderDetailBody();
    }
    default:
      return undefined;
  }
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
    if (!el || el.disabled) return;
    if (el.closest("#menu")) return;
    e.preventDefault();
    handleAction(el.dataset.action, el);
  });

  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#menu") && !e.target.closest('[data-action="menu"], [data-action="app-menu"]')) closeMenu();
  });

  document.addEventListener("contextmenu", (e) => {
    const el = e.target.closest("[data-ctx]");
    if (!el) return;
    e.preventDefault();
    openMenu(menuFor(el), { x: e.clientX, y: e.clientY });
  });

  document.addEventListener("keydown", (e) => {
    const typing = e.target.matches("input, textarea");
    if (e.key === "Escape") {
      if (!$("#menu").hidden) return closeMenu();
      if (state.detail) return closeDetail();
      if (typing && e.target.value) {
        e.target.value = "";
        state.filters[state.view] = "";
        syncClear();
        return renderList();
      }
      if (typing) e.target.blur();
      return;
    }
    if (!$("#menu").hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const items = [...document.querySelectorAll("#menu .menu-item:not([disabled])")];
      const i = items.indexOf(document.activeElement);
      const next = i < 0 ? items[e.key === "ArrowDown" ? 0 : items.length - 1] : items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      next?.focus();
      e.preventDefault();
      return;
    }
    if ((e.metaKey && e.key === "f") || (!typing && e.key === "/")) {
      e.preventDefault();
      if (state.detail) closeDetail();
      $("#filter").focus();
      $("#filter").select();
      return;
    }
    if (!typing && e.key === "Enter") {
      const row = e.target.closest?.(".row[data-action]");
      if (row) {
        e.preventDefault();
        handleAction(row.dataset.action, row);
      }
    }
  });

  $("#filter").addEventListener("input", (e) => {
    state.filters[state.view] = e.target.value;
    syncClear();
    renderList();
  });

  $("#list").addEventListener("scroll", closeMenu, { passive: true });
  window.addEventListener("blur", closeMenu);
  window.addEventListener("resize", closeMenu);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pump();
  });

  const m = mx();
  try {
    m.events?.subscribe?.("command.refresh", () => refreshAll());
    m.events?.subscribe?.("project.switched", () => {
      // exec runs on the project's server, so a remote project can mean a different Docker host.
      if (state.conn.status === "ok") kick("containers", "df", "stats", VIEW_TASK[state.view]);
      connect();
    });
  } catch (e) {
    console.warn("[docker] couldn't subscribe to events:", e?.message || e);
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
  await loadPrefs();
  console.log(`[docker] ${state.mode} started`);
  bindEvents();
  renderAll();
  await connect();
  setInterval(pump, 500);
}

init().catch((e) => console.error("[docker] failed to start:", e?.stack || e));
