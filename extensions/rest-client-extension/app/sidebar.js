// The sidebar: open request tabs (in the current project), saved collections
// with folders, history, and environments. Request tabs report to the
// background hub, which sends the open list here.
import {
  $, $$, mx, esc, uid, debounce, initTheme, toast, toastError, copyText, confirmDialog, promptDialog, pick,
  openMenu, closeMenu, menuOpen, methodClass, methodShort, statusClass, relTime,
} from "./ui.js";
import { icon } from "./icons.js";
import * as store from "./store.js";
import { mountKv } from "./kv.js";
import { prepare, toCurlCommand } from "./http.js";

const HISTORY_PAGE = 30;

const S = {
  tree: { nodes: [] },
  drafts: new Set(),
  envs: { active: null, globals: [], list: [] },
  history: [],
  historyShown: HISTORY_PAGE,
  open: [], // from the hub: [{ inst, tabID, projectID, id, name, method, url, dirty, scratch }]
  active: null, // focused tabID
  currentTabIds: null, // tab ids in the current project
  filter: "",
  renaming: null,
  drag: null,
  pane: null,
  envSel: null,
  prefs: { sections: { open: true, collections: true, history: true }, expanded: {} },
  flash: null,
};

const savePrefs = debounce(() => store.savePrefs("sidebar", S.prefs), 300);

// ---------------------------------------------------------------- data

async function reloadTree() {
  S.tree = await store.loadTree();
}

async function reloadDrafts() {
  S.drafts = await store.draftIds();
}

async function reloadEnvs() {
  S.envs = await store.loadEnvs();
}

async function reloadHistory() {
  S.history = await store.loadHistory();
}

async function refreshCurrentTabs() {
  try {
    const list = await mx().tabs.list();
    S.currentTabIds = new Set((list || []).map((t) => t.id));
  } catch {
    S.currentTabIds = null;
  }
}

function openHere() {
  return S.open.filter((t) => t.id && (S.currentTabIds ? t.tabID && S.currentTabIds.has(t.tabID) : true));
}

function openTabFor(id) {
  return openHere().find((t) => t.id === id) || null;
}

function activeRequestId() {
  return S.open.find((t) => t.tabID && t.tabID === S.active)?.id || null;
}

// ---------------------------------------------------------------- actions

async function openRequest(id) {
  const t = openTabFor(id);
  try {
    if (t?.tabID) {
      await mx().tabs.switchTo(t.tabID);
      return;
    }
    await store.openRequestTab(id);
  } catch (e) {
    toastError(e, "Couldn't open the request");
  }
}

async function focusTab(t) {
  if (!t.tabID) {
    store.relay({ type: "need-tab-id", inst: t.inst });
    return;
  }
  try {
    await mx().tabs.switchTo(t.tabID);
  } catch (e) {
    toastError(e, "Couldn't switch to that tab");
  }
}

function closeTabs(list) {
  if (!list.length) return;
  store.relay({ type: "close", insts: list.map((t) => t.inst) });
}

function newScratch() {
  store.hub("new-request");
}

async function newSavedRequest(parent = null) {
  try {
    const r = await store.createRequest(store.emptyRequest({ name: "New Request" }), parent);
    if (parent) S.prefs.expanded[parent] = true;
    S.prefs.sections.collections = true;
    savePrefs();
    store.notifyChanged("tree", { ids: [r.id] });
    await reloadTree();
    S.flash = r.id;
    render();
    await openRequest(r.id);
  } catch (e) {
    toastError(e, "Couldn't create the request");
  }
}

async function newFolder(parent = null) {
  try {
    const f = await store.createFolder("New Folder", parent);
    if (parent) S.prefs.expanded[parent] = true;
    S.prefs.expanded[f.id] = true;
    S.prefs.sections.collections = true;
    savePrefs();
    store.notifyChanged("tree", { ids: [f.id] });
    await reloadTree();
    startRename(f.id);
  } catch (e) {
    toastError(e, "Couldn't create the folder");
  }
}

function startRename(id) {
  S.renaming = id;
  render();
  const input = $(".rename-input");
  if (input) {
    input.focus({ preventScroll: true });
    input.select();
    input.scrollIntoView({ block: "nearest" });
  }
}

async function commitRename(value) {
  const id = S.renaming;
  S.renaming = null;
  const node = store.nodeById(S.tree, id);
  const name = String(value || "").trim();
  if (!node || !name || name === node.name) {
    render();
    return;
  }
  try {
    await store.renameNode(id, name);
    store.notifyChanged("tree", { ids: [id] });
    await reloadTree();
  } catch (e) {
    toastError(e, "Couldn't rename");
  }
  render();
}

async function removeNodeAsk(id) {
  const node = store.nodeById(S.tree, id);
  if (!node) return;
  const ids = store.descendants(S.tree, id);
  const requests = ids.filter((x) => store.nodeById(S.tree, x)?.kind === "request").length;
  const choice = await confirmDialog({
    title: `Delete “${node.name}”?`,
    message:
      node.kind === "folder"
        ? requests
          ? `This deletes the folder and the ${requests} request${requests === 1 ? "" : "s"} in it. Open tabs for them close.`
          : "This deletes the empty folder."
        : "This deletes the saved request. If it's open, its tab closes.",
    buttons: ["Delete", "Cancel"],
    default: "Cancel",
    cancel: "Cancel",
  });
  if (choice !== "Delete") return;
  try {
    const removed = await store.removeNode(id);
    store.relay({ type: "close", ids: removed, force: true });
    store.notifyChanged("tree", { ids: removed, removed: true });
    await Promise.all([reloadTree(), reloadDrafts()]);
    render();
  } catch (e) {
    toastError(e, "Couldn't delete");
  }
}

async function duplicate(id) {
  try {
    const copy = await store.duplicateNode(id);
    if (!copy) return;
    store.notifyChanged("tree", { ids: [copy.id] });
    await reloadTree();
    S.flash = copy.id;
    if (copy.kind === "folder") S.prefs.expanded[copy.id] = !!S.prefs.expanded[id];
    render();
  } catch (e) {
    toastError(e, "Couldn't duplicate");
  }
}

async function moveTo(id) {
  const node = store.nodeById(S.tree, id);
  if (!node) return;
  const blocked = new Set(store.descendants(S.tree, id));
  const folders = store.folderPaths(S.tree).filter((f) => !blocked.has(f.id));
  const choice = await pick({
    placeholder: `Move “${node.name}” to…`,
    items: [{ id: "__root__", title: "Top level", subtitle: "Not in a folder" }, ...folders.map((f) => ({ id: f.id, title: f.name, subtitle: f.path === f.name ? "Folder" : f.path }))],
  });
  if (!choice) return;
  const parent = choice.id === "__root__" ? null : choice.id;
  await doMove(id, parent, null);
}

async function doMove(id, parent, beforeId) {
  try {
    const ok = await store.moveNode(id, parent, beforeId);
    if (!ok) return;
    if (parent) S.prefs.expanded[parent] = true;
    savePrefs();
    const ids = store.descendants(S.tree, id);
    store.notifyChanged("tree", { ids });
    await reloadTree();
    S.flash = id;
    render();
  } catch (e) {
    toastError(e, "Couldn't move");
  }
}

async function openHistory(h) {
  try {
    await store.openScratch({ ...h.req, name: h.req.name });
  } catch (e) {
    toastError(e, "Couldn't open");
  }
}

async function clearHistoryAsk() {
  if (!S.history.length) return;
  const choice = await confirmDialog({
    title: "Clear history?",
    message: `This removes all ${S.history.length} entries. Saved requests stay.`,
    buttons: ["Clear", "Cancel"],
    default: "Cancel",
    cancel: "Cancel",
  });
  if (choice !== "Clear") return;
  await store.clearHistory();
  store.notifyChanged("history");
  S.history = [];
  render();
}

function revealNode(id) {
  const node = store.nodeById(S.tree, id);
  if (!node) return;
  for (const a of store.ancestors(S.tree, id)) S.prefs.expanded[a.id] = true;
  S.prefs.sections.collections = true;
  savePrefs();
  if (S.filter) setFilter("");
  closePane();
  S.flash = id;
  render();
  $(`.row[data-kind="node"][data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center" });
}

async function setActiveEnv(id) {
  try {
    S.envs = await store.updateEnvs((e) => {
      e.active = id;
    });
    store.notifyChanged("envs");
    renderTop();
    if (S.pane === "envs") renderEnvPane();
  } catch (e) {
    toastError(e, "Couldn't switch environment");
  }
}

// ---------------------------------------------------------------- menus

function topMenu(anchor) {
  const anyExpanded = Object.values(S.prefs.expanded).some(Boolean);
  openMenu(
    [
      { label: "New Request", icon: "plus", run: newScratch },
      { label: "New Saved Request", icon: "save", run: () => newSavedRequest(null) },
      { label: "New Folder", icon: "folder-plus", run: () => newFolder(null) },
      "-",
      { label: "Manage Environments…", icon: "sliders", run: () => openPane("envs") },
      "-",
      { label: anyExpanded ? "Collapse All Folders" : "Expand All Folders", icon: "collapse", run: () => toggleAllFolders(!anyExpanded) },
      { label: "Clear History…", icon: "history", disabled: !S.history.length, run: clearHistoryAsk },
    ],
    anchor
  );
}

function toggleAllFolders(open) {
  S.prefs.expanded = {};
  if (open) for (const n of S.tree.nodes) if (n.kind === "folder") S.prefs.expanded[n.id] = true;
  savePrefs();
  render();
}

function envMenu(anchor) {
  openMenu(
    [
      { header: "Environment" },
      { label: "No Environment", checked: !S.envs.active, run: () => setActiveEnv(null) },
      ...S.envs.list.map((e) => ({ label: e.name, checked: e.id === S.envs.active, run: () => setActiveEnv(e.id) })),
      "-",
      { label: "Manage Environments…", icon: "sliders", run: () => openPane("envs") },
    ],
    anchor,
    { align: "left" }
  );
}

function nodeMenu(id, anchor) {
  const node = store.nodeById(S.tree, id);
  if (!node) return;
  const common = [
    { label: "Rename", icon: "pencil", run: () => startRename(id) },
    { label: "Duplicate", icon: "copy", run: () => duplicate(id) },
    { label: "Move to…", icon: "move", run: () => moveTo(id) },
  ];
  const items =
    node.kind === "folder"
      ? [
          { label: "New Request Here", icon: "plus", run: () => newSavedRequest(id) },
          { label: "New Folder Here", icon: "folder-plus", run: () => newFolder(id) },
          "-",
          ...common,
          "-",
          { label: "Delete Folder…", icon: "trash", danger: true, run: () => removeNodeAsk(id) },
        ]
      : [
          { label: openTabFor(id) ? "Go to Tab" : "Open", icon: "arrows", run: () => openRequest(id) },
          "-",
          ...common,
          { label: "Copy URL", icon: "link", disabled: !node.url, run: () => copyText(node.url, "URL copied") },
          "-",
          { label: "Delete…", icon: "trash", danger: true, run: () => removeNodeAsk(id) },
        ];
  openMenu(items, anchor);
}

function openRowMenu(inst, anchor) {
  const here = openHere();
  const t = here.find((x) => x.inst === inst);
  if (!t) return;
  openMenu(
    [
      { label: "Close", icon: "x", run: () => closeTabs([t]) },
      { label: "Close Others", icon: "x", disabled: here.length < 2, run: () => closeTabs(here.filter((x) => x.inst !== inst)) },
      { label: "Close All", icon: "x", run: () => closeTabs(here) },
      "-",
      !t.scratch ? { label: "Show in Collections", icon: "folder", run: () => revealNode(t.id) } : null,
    ],
    anchor
  );
}

function histMenu(id, anchor) {
  const h = S.history.find((x) => x.id === id);
  if (!h) return;
  const saved = h.requestId && store.nodeById(S.tree, h.requestId);
  openMenu(
    [
      { label: "Open as New Request", icon: "arrows", run: () => openHistory(h) },
      saved ? { label: "Open Saved Request", icon: "save", run: () => openRequest(h.requestId) } : null,
      "-",
      { label: "Copy URL", icon: "link", run: () => copyText(h.req.url, "URL copied") },
      {
        label: "Copy as cURL",
        icon: "terminal",
        run: () => {
          try {
            copyText(toCurlCommand(prepare(h.req, store.envVars(S.envs))), "Copied as cURL");
          } catch (e) {
            toastError(e);
          }
        },
      },
      "-",
      {
        label: "Remove from History",
        icon: "trash",
        run: async () => {
          await store.removeHistory(id);
          store.notifyChanged("history");
          await reloadHistory();
          render();
        },
      },
    ],
    anchor
  );
}

// ---------------------------------------------------------------- filter

function setFilter(v) {
  S.filter = v;
  const input = $("#filter");
  if (input.value !== v) input.value = v;
  $("#filter-clear").hidden = !v;
  render();
}

function matches(text) {
  return String(text || "").toLowerCase().includes(S.filter.toLowerCase());
}

// Which tree nodes to show while filtering: matches, their ancestors, and
// everything inside a matching folder.
function visibleIds() {
  if (!S.filter) return null;
  const show = new Set();
  for (const n of S.tree.nodes) {
    const hit = n.kind === "folder" ? matches(n.name) : matches(n.name) || matches(n.url) || matches(n.method);
    if (!hit) continue;
    show.add(n.id);
    for (const a of store.ancestors(S.tree, n.id)) show.add(a.id);
    if (n.kind === "folder") for (const d of store.descendants(S.tree, n.id)) show.add(d);
  }
  return show;
}

// ---------------------------------------------------------------- render

function renderTop() {
  const env = store.activeEnv(S.envs);
  const btn = $("#env-btn");
  btn.classList.toggle("on", !!env);
  btn.innerHTML = `${icon("layers")}<span class="env-name">${esc(env ? env.name : "No Environment")}</span>${icon("chevron-down", "env-chev")}`;
}

function sectionHead(id, title, count, actions) {
  const open = S.filter ? true : S.prefs.sections[id] !== false;
  return `<div class="sec-head${open ? " open" : ""}" data-section="${id}">
    <button class="sec-toggle" data-act="toggle-section" data-section-id="${id}">${icon("chevron", "sec-chev")}<span>${title}</span>${count ? `<span class="sec-count">${count}</span>` : ""}</button>
    <span class="sec-actions">${actions || ""}</span>
  </div>`;
}

function openRows() {
  const here = openHere().filter((t) => !S.filter || matches(t.name) || matches(t.url) || matches(t.method));
  if (!here.length) return S.filter ? "" : `<div class="sec-note">Requests you open show up here.</div>`;
  return here
    .map(
      (t) => `<div class="row open-row${t.tabID && t.tabID === S.active ? " active" : ""}" data-kind="open" data-inst="${esc(t.inst)}" title="${esc(t.url || t.name)}" tabindex="-1">
        <span class="mbadge ${methodClass(t.method)}">${esc(methodShort(t.method))}</span>
        <span class="row-name">${esc(t.name || "Untitled Request")}</span>
        ${t.scratch ? '<span class="row-tag">unsaved</span>' : ""}
        ${t.dirty ? '<span class="dirty-dot" title="Unsaved changes"></span>' : ""}
        <span class="row-actions"><button class="icon-btn" data-act="close-tab" title="Close">${icon("x")}</button></span>
      </div>`
    )
    .join("");
}

function countRequests(id) {
  return store.descendants(S.tree, id).filter((x) => store.nodeById(S.tree, x)?.kind === "request").length;
}

function treeRows() {
  const show = visibleIds();
  const activeId = activeRequestId();
  const openIds = new Set(openHere().map((t) => t.id));
  const dirtyIds = new Set([...S.drafts, ...S.open.filter((t) => t.dirty).map((t) => t.id)]);
  let html = "";
  const walk = (parent, depth) => {
    for (const n of store.childrenOf(S.tree, parent)) {
      if (show && !show.has(n.id)) continue;
      const renaming = S.renaming === n.id;
      const name = renaming
        ? `<input class="rename-input" value="${esc(n.name)}" spellcheck="false" autocomplete="off">`
        : `<span class="row-name">${esc(n.name)}</span>`;
      const cls = [`row`, `node-row`, n.kind, S.flash === n.id ? "flash" : "", n.id === activeId ? "active" : ""].filter(Boolean).join(" ");
      if (n.kind === "folder") {
        const expanded = !!show || !!S.prefs.expanded[n.id];
        const count = countRequests(n.id);
        html += `<div class="${cls}${expanded ? " expanded" : ""}" data-kind="node" data-id="${esc(n.id)}" draggable="${renaming ? "false" : "true"}" style="--depth:${depth}" tabindex="-1">
          ${icon("chevron", "twisty")}
          ${icon(expanded ? "folder-open" : "folder", "folder-icon")}
          ${name}
          ${count && !renaming ? `<span class="row-count">${count}</span>` : ""}
          <span class="row-actions"><button class="icon-btn" data-act="folder-add" title="New request in this folder">${icon("plus")}</button><button class="icon-btn" data-act="node-menu" title="More">${icon("more")}</button></span>
        </div>`;
        if (expanded) walk(n.id, depth + 1);
      } else {
        html += `<div class="${cls}" data-kind="node" data-id="${esc(n.id)}" draggable="${renaming ? "false" : "true"}" style="--depth:${depth}" title="${esc(n.url || "")}" tabindex="-1">
          <span class="twisty-space"></span>
          <span class="mbadge ${methodClass(n.method)}">${esc(methodShort(n.method))}</span>
          ${name}
          ${dirtyIds.has(n.id) ? '<span class="dirty-dot" title="Unsaved changes"></span>' : openIds.has(n.id) ? '<span class="open-dot" title="Open"></span>' : ""}
          <span class="row-actions"><button class="icon-btn" data-act="node-menu" title="More">${icon("more")}</button></span>
        </div>`;
      }
    }
  };
  walk(null, 0);
  if (!html) {
    if (S.filter) return `<div class="sec-note">No saved requests match “${esc(S.filter)}”.</div>`;
    return `<div class="empty">
      ${icon("folder")}
      <div class="empty-title">No saved requests yet</div>
      <div class="empty-text">Save a request from its tab (${/Mac/i.test(navigator.platform) ? "⌘S" : "Ctrl+S"}), or start one here.</div>
      <div class="empty-actions"><button class="btn" data-act="new-saved">${icon("plus")}<span>Request</span></button><button class="btn" data-act="new-folder">${icon("folder-plus")}<span>Folder</span></button></div>
    </div>`;
  }
  return `<div class="tree">${html}<div class="tree-end" data-drop="root"></div></div>`;
}

function shortUrl(url) {
  return String(url || "").replace(/^https?:\/\//i, "");
}

function historyRows() {
  const list = S.history.filter((h) => !S.filter || matches(h.req.url) || matches(h.req.name) || matches(h.req.method));
  if (!list.length) return S.filter ? "" : `<div class="sec-note">Requests you send show up here.</div>`;
  const shown = list.slice(0, S.filter ? 100 : S.historyShown);
  return (
    shown
      .map((h) => {
        const status = h.error ? `<span class="hstatus err" title="${esc(h.error)}">ERR</span>` : `<span class="hstatus ${statusClass(h.status)}">${h.status || "—"}</span>`;
        return `<div class="row hist-row" data-kind="hist" data-id="${esc(h.id)}" title="${esc(`${h.req.method} ${h.req.url}${h.error ? `\n${h.error}` : ""}`)}" tabindex="-1">
          ${status}
          <span class="mbadge ${methodClass(h.req.method)}">${esc(methodShort(h.req.method))}</span>
          <span class="row-name mono-ish">${esc(shortUrl(h.req.url))}</span>
          <span class="row-time">${esc(relTime(h.at))}</span>
          <span class="row-actions"><button class="icon-btn" data-act="hist-menu" title="More">${icon("more")}</button></span>
        </div>`;
      })
      .join("") +
    (!S.filter && list.length > shown.length ? `<button class="more-btn" data-act="more-history">Show ${Math.min(HISTORY_PAGE, list.length - shown.length)} more</button>` : "")
  );
}

function render() {
  const list = $("#list");
  const scroll = list.scrollTop;
  const here = openHere();
  const sec = (id) => S.filter || S.prefs.sections[id] !== false;
  const treeCount = S.tree.nodes.filter((n) => n.kind === "request").length;
  list.innerHTML = `
    <section class="sec" data-sec="open">
      ${sectionHead("open", "Open", here.length || "", here.length ? `<button class="icon-btn" data-act="close-all" title="Close all">${icon("x")}</button>` : "")}
      ${sec("open") ? `<div class="sec-body">${openRows()}</div>` : ""}
    </section>
    <section class="sec" data-sec="collections">
      ${sectionHead(
        "collections",
        "Collections",
        treeCount || "",
        `<button class="icon-btn" data-act="new-saved" title="New saved request">${icon("plus")}</button><button class="icon-btn" data-act="new-folder" title="New folder">${icon("folder-plus")}</button>`
      )}
      ${sec("collections") ? `<div class="sec-body">${treeRows()}</div>` : ""}
    </section>
    <section class="sec" data-sec="history">
      ${sectionHead("history", "History", S.history.length || "", "")}
      ${sec("history") ? `<div class="sec-body">${historyRows()}</div>` : ""}
    </section>`;
  list.scrollTop = scroll;
  if (S.flash) {
    const id = S.flash;
    setTimeout(() => {
      if (S.flash === id) {
        S.flash = null;
        $(`.row.flash`)?.classList.remove("flash");
      }
    }, 1400);
  }
}

// ---------------------------------------------------------------- environments pane

function openPane(name) {
  S.pane = name;
  if (!S.envSel || (S.envSel !== "globals" && !S.envs.list.some((e) => e.id === S.envSel))) S.envSel = S.envs.active || S.envs.list[0]?.id || "globals";
  const d = $("#detail");
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
  renderEnvPane();
}

function closePane() {
  if (!S.pane) return;
  saveEnvEdit.flush();
  S.pane = null;
  const d = $("#detail");
  d.classList.remove("open");
  d.setAttribute("aria-hidden", "true");
  render();
}

const saveEnvEdit = debounce(async () => {
  const sel = S.envSel;
  const local = sel === "globals" ? null : S.envs.list.find((e) => e.id === sel);
  try {
    await store.updateEnvs((e) => {
      if (sel === "globals") e.globals = S.envs.globals;
      else if (local) {
        const t = e.list.find((x) => x.id === sel);
        if (t) {
          t.name = local.name;
          t.vars = local.vars;
        }
      }
    });
    store.notifyChanged("envs");
  } catch (err) {
    toastError(err, "Couldn't save the environment");
  }
}, 300);

function envListHtml() {
  const item = (id, name, sub, active) => `<div class="env-item${S.envSel === id ? " sel" : ""}" data-env="${esc(id)}" tabindex="-1">
      ${id === "globals" ? icon("globe", "env-icon") : `<button class="env-radio${active ? " on" : ""}" data-act="env-activate" title="${active ? "Active" : "Use this environment"}">${active ? icon("check") : ""}</button>`}
      <span class="env-item-name">${esc(name)}</span>
      ${sub ? `<span class="env-item-sub">${esc(sub)}</span>` : ""}
      ${id !== "globals" ? `<button class="icon-btn env-more" data-act="env-menu" title="More">${icon("more")}</button>` : ""}
    </div>`;
  const varCount = (rows) => rows.filter((r) => r.key).length;
  return [
    item("globals", "Globals", `${varCount(S.envs.globals)}`, false),
    ...S.envs.list.map((e) => item(e.id, e.name, `${varCount(e.vars)}`, e.id === S.envs.active)),
  ].join("");
}

function renderEnvPane() {
  const d = $("#detail");
  const sel = S.envSel;
  const env = sel === "globals" ? null : S.envs.list.find((e) => e.id === sel);
  const editor =
    sel === "globals"
      ? `<div class="env-editor-head"><div class="env-title">Globals</div></div><p class="env-note">Used in every environment. When the active environment defines the same name, its value wins.</p>`
      : env
        ? `<div class="env-editor-head"><input class="field env-name-input" id="env-name" value="${esc(env.name)}" spellcheck="false" autocomplete="off" aria-label="Environment name">${
            env.id === S.envs.active ? `<span class="env-active-chip">${icon("check")}Active</span>` : `<button class="btn" data-act="env-use">Use</button>`
          }</div>`
        : `<p class="env-note">Pick an environment.</p>`;
  d.innerHTML = `<header class="d-head">
      <button class="icon-btn" data-act="pane-back" title="Back" aria-label="Back">${icon("back")}</button>
      <span class="d-title">Environments</span>
      <button class="icon-btn" data-act="env-new" title="New environment">${icon("plus")}</button>
    </header>
    <div class="d-body scroll">
      <div class="env-list">${envListHtml()}</div>
      <div class="env-editor">${editor}<div class="env-kv"></div>
        <p class="env-note">Write <span class="mono">{{name}}</span> in a URL, header, body, or auth field to use a variable. Also available: <span class="mono">{{$uuid}}</span>, <span class="mono">{{$timestamp}}</span>, <span class="mono">{{$isoTimestamp}}</span>, <span class="mono">{{$randomInt}}</span>.</p>
      </div>
    </div>`;
  const rows = sel === "globals" ? S.envs.globals : env?.vars;
  if (rows) {
    mountKv(d.querySelector(".env-kv"), {
      rows,
      keyPlaceholder: "Variable",
      onChange: () => {
        saveEnvEdit();
        const sub = d.querySelector(`.env-item[data-env="${CSS.escape(sel)}"] .env-item-sub`);
        if (sub) sub.textContent = String(rows.filter((r) => r.key).length);
      },
    });
  }
}

async function newEnv() {
  try {
    saveEnvEdit.flush();
    const id = uid();
    S.envs = await store.updateEnvs((e) => {
      e.list.push({ id, name: `Environment ${e.list.length + 1}`, vars: [{ key: "baseUrl", value: "http://localhost:3000", enabled: true }] });
      if (!e.active) e.active = id;
    });
    store.notifyChanged("envs");
    S.envSel = id;
    renderTop();
    renderEnvPane();
    const input = $("#env-name");
    input?.focus({ preventScroll: true });
    input?.select();
  } catch (e) {
    toastError(e, "Couldn't add the environment");
  }
}

function envItemMenu(id, anchor) {
  const env = S.envs.list.find((e) => e.id === id);
  if (!env) return;
  openMenu(
    [
      env.id === S.envs.active
        ? { label: "Stop Using", icon: "x", run: () => setActiveEnv(null) }
        : { label: "Use", icon: "check", run: () => setActiveEnv(id) },
      {
        label: "Duplicate",
        icon: "copy",
        run: async () => {
          saveEnvEdit.flush();
          const copyId = uid();
          S.envs = await store.updateEnvs((e) => {
            const src = e.list.find((x) => x.id === id);
            if (src) e.list.splice(e.list.indexOf(src) + 1, 0, { id: copyId, name: `${src.name} copy`, vars: src.vars.map((v) => ({ ...v })) });
          });
          store.notifyChanged("envs");
          S.envSel = copyId;
          renderEnvPane();
        },
      },
      "-",
      {
        label: "Delete…",
        icon: "trash",
        danger: true,
        run: async () => {
          const choice = await confirmDialog({ title: `Delete “${env.name}”?`, message: "Its variables are deleted too.", buttons: ["Delete", "Cancel"], default: "Cancel", cancel: "Cancel" });
          if (choice !== "Delete") return;
          saveEnvEdit.cancel();
          S.envs = await store.updateEnvs((e) => {
            e.list = e.list.filter((x) => x.id !== id);
            if (e.active === id) e.active = null;
          });
          store.notifyChanged("envs");
          if (S.envSel === id) S.envSel = S.envs.list[0]?.id || "globals";
          renderTop();
          renderEnvPane();
        },
      },
    ],
    anchor
  );
}

function bindPane() {
  const d = $("#detail");
  d.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    const item = e.target.closest(".env-item");
    if (act === "pane-back") return closePane();
    if (act === "env-new") return newEnv();
    if (act === "env-use") return setActiveEnv(S.envSel);
    if (act === "env-activate" && item) {
      const id = item.dataset.env;
      return setActiveEnv(id === S.envs.active ? null : id);
    }
    if (act === "env-menu" && item) return envItemMenu(item.dataset.env, e.target.closest("[data-act]"));
    if (item && !act) {
      if (item.dataset.env === S.envSel) return;
      saveEnvEdit.flush();
      S.envSel = item.dataset.env;
      renderEnvPane();
    }
  });
  d.addEventListener("input", (e) => {
    if (e.target.id !== "env-name") return;
    const env = S.envs.list.find((x) => x.id === S.envSel);
    if (!env) return;
    env.name = e.target.value;
    const nameEl = d.querySelector(`.env-item[data-env="${CSS.escape(env.id)}"] .env-item-name`);
    if (nameEl) nameEl.textContent = env.name;
    saveEnvEdit();
    if (env.id === S.envs.active) renderTop();
  });
  d.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menuOpen() && !e.target.closest("input, textarea")) {
      e.preventDefault();
      closePane();
    }
  });
}

// ---------------------------------------------------------------- list events

function bindList() {
  const list = $("#list");

  list.addEventListener("click", (e) => {
    const actEl = e.target.closest("[data-act]");
    const act = actEl?.dataset.act;
    const row = e.target.closest(".row");
    if (act === "toggle-section") {
      const id = actEl.dataset.sectionId;
      if (S.filter) return;
      S.prefs.sections[id] = S.prefs.sections[id] === false;
      savePrefs();
      render();
      return;
    }
    if (act === "close-all") return closeTabs(openHere());
    if (act === "new-saved") return newSavedRequest(null);
    if (act === "new-folder") return newFolder(null);
    if (act === "more-history") {
      S.historyShown += HISTORY_PAGE;
      render();
      return;
    }
    if (!row) return;
    const kind = row.dataset.kind;
    if (kind === "open") {
      const t = openHere().find((x) => x.inst === row.dataset.inst);
      if (!t) return;
      if (act === "close-tab") return closeTabs([t]);
      return focusTab(t);
    }
    if (kind === "node") {
      if (S.renaming === row.dataset.id) return;
      const id = row.dataset.id;
      const node = store.nodeById(S.tree, id);
      if (!node) return;
      if (act === "node-menu") return nodeMenu(id, actEl);
      if (act === "folder-add") return newSavedRequest(id);
      if (node.kind === "folder") {
        S.prefs.expanded[id] = !S.prefs.expanded[id];
        savePrefs();
        render();
      } else {
        openRequest(id);
      }
      return;
    }
    if (kind === "hist") {
      if (act === "hist-menu") return histMenu(row.dataset.id, actEl);
      const h = S.history.find((x) => x.id === row.dataset.id);
      if (h) openHistory(h);
    }
  });

  list.addEventListener("dblclick", (e) => {
    const row = e.target.closest('.row[data-kind="node"]');
    if (!row || e.target.closest("[data-act]") || S.renaming) return;
    const node = store.nodeById(S.tree, row.dataset.id);
    if (node?.kind === "folder") startRename(node.id);
  });

  list.addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".row");
    if (!row) return;
    e.preventDefault();
    const at = { x: e.clientX, y: e.clientY };
    if (row.dataset.kind === "node") nodeMenu(row.dataset.id, at);
    else if (row.dataset.kind === "open") openRowMenu(row.dataset.inst, at);
    else if (row.dataset.kind === "hist") histMenu(row.dataset.id, at);
  });

  list.addEventListener("keydown", (e) => {
    if (!e.target.classList.contains("rename-input")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename(e.target.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      S.renaming = null;
      render();
    }
  });

  list.addEventListener(
    "blur",
    (e) => {
      if (e.target.classList?.contains("rename-input") && S.renaming) commitRename(e.target.value);
    },
    true
  );

  // ------------------------------------------------ drag and drop
  let dropEl = null;
  const clearDrop = () => {
    dropEl?.classList.remove("drop-before", "drop-after", "drop-inside", "drop-root");
    dropEl = null;
  };
  const dropTarget = (e) => {
    if (!S.drag) return null;
    const row = e.target.closest('.row[data-kind="node"]');
    if (row) {
      const id = row.dataset.id;
      const node = store.nodeById(S.tree, id);
      if (!node || store.descendants(S.tree, S.drag).includes(id)) return null;
      const r = row.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      if (node.kind === "folder") {
        if (y < 0.28) return { el: row, node, pos: "before" };
        if (y > 0.72) {
          const expanded = !!S.prefs.expanded[id] && store.childrenOf(S.tree, id).some((c) => c.id !== S.drag);
          return { el: row, node, pos: expanded ? "inside-first" : "after" };
        }
        return { el: row, node, pos: "inside" };
      }
      return { el: row, node, pos: y < 0.5 ? "before" : "after" };
    }
    const end = e.target.closest('[data-drop="root"], .sec-head[data-section="collections"]');
    if (end) return { el: end, node: null, pos: "root" };
    return null;
  };

  list.addEventListener("dragstart", (e) => {
    const row = e.target.closest('.row[data-kind="node"]');
    if (!row || S.renaming || S.filter) {
      if (S.filter) e.preventDefault();
      return;
    }
    S.drag = row.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", S.drag);
    requestAnimationFrame(() => row.classList.add("dragging"));
  });
  list.addEventListener("dragover", (e) => {
    const t = dropTarget(e);
    if (!t) {
      clearDrop();
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropEl !== t.el) clearDrop();
    dropEl = t.el;
    dropEl.classList.remove("drop-before", "drop-after", "drop-inside", "drop-root");
    dropEl.classList.add(t.pos === "inside-first" ? "drop-inside" : `drop-${t.pos}`);
  });
  list.addEventListener("dragleave", (e) => {
    if (dropEl && !list.contains(e.relatedTarget)) clearDrop();
  });
  list.addEventListener("drop", async (e) => {
    const t = dropTarget(e);
    clearDrop();
    const id = S.drag;
    S.drag = null;
    if (!t || !id) return;
    e.preventDefault();
    if (t.node && t.node.id === id) return;
    let parent = null;
    let before = null;
    if (t.pos === "before") {
      parent = t.node.parent || null;
      before = t.node.id;
    } else if (t.pos === "after") {
      parent = t.node.parent || null;
      const sibs = store.childrenOf(S.tree, parent).filter((n) => n.id !== id);
      before = sibs[sibs.indexOf(t.node) + 1]?.id || null;
    } else if (t.pos === "inside") {
      parent = t.node.id;
    } else if (t.pos === "inside-first") {
      parent = t.node.id;
      before = store.childrenOf(S.tree, parent).find((n) => n.id !== id)?.id || null;
    }
    await doMove(id, parent, before);
  });
  list.addEventListener("dragend", () => {
    S.drag = null;
    clearDrop();
    $$(".row.dragging").forEach((r) => r.classList.remove("dragging"));
  });
}

// ---------------------------------------------------------------- bus

async function onBus(msg) {
  switch (msg.type) {
    case "open":
      S.open = Array.isArray(msg.tabs) ? msg.tabs : [];
      S.active = msg.active || null;
      await Promise.all([refreshCurrentTabs(), reloadDrafts()]);
      if (!S.renaming) render();
      break;
    case "hub-ready":
      store.hub("hello", { role: "panel" });
      break;
    case "changed":
      if (msg.what === "tree") {
        await Promise.all([reloadTree(), reloadDrafts()]);
        if (!S.renaming) render();
      } else if (msg.what === "history") {
        await reloadHistory();
        if (!S.renaming && !S.pane) render();
      } else if (msg.what === "envs" && msg.from !== store.PAGE) {
        await reloadEnvs();
        renderTop();
        if (S.pane === "envs" && !$("#detail").contains(document.activeElement)) renderEnvPane();
      }
      break;
    case "show-envs":
      openPane("envs");
      store.sdel("ui:pending");
      break;
    case "reveal":
      if (msg.id) revealNode(msg.id);
      store.sdel("ui:pending");
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
  $("#search-icon").outerHTML = icon("search");
  $("#filter-clear").innerHTML = icon("x");
  $("#menu-btn").innerHTML = icon("more");

  const prefs = await store.loadPrefs("sidebar", S.prefs);
  S.prefs = { sections: { ...S.prefs.sections, ...(prefs.sections || {}) }, expanded: { ...(prefs.expanded || {}) } };
  await Promise.all([reloadTree(), reloadDrafts(), reloadEnvs(), reloadHistory(), refreshCurrentTabs()]);
  renderTop();
  render();
  bindList();
  bindPane();

  $("#env-btn").addEventListener("click", (e) => envMenu(e.currentTarget));
  $("#menu-btn").addEventListener("click", (e) => topMenu(e.currentTarget));
  $("#filter").addEventListener("input", (e) => setFilter(e.target.value));
  $("#filter").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setFilter("");
      e.target.blur();
    }
  });
  $("#filter-clear").addEventListener("click", () => setFilter(""));
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest?.("input, textarea, select");
    if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f")) {
      e.preventDefault();
      if (S.pane) closePane();
      $("#filter").focus({ preventScroll: true });
      $("#filter").select();
    } else if (e.key === "Escape" && S.pane && !typing && !menuOpen()) {
      closePane();
    }
  });

  store.onBus(onBus);
  for (const ev of ["project.switched", "worktree.switched"]) {
    try {
      m.events.subscribe(ev, async () => {
        await refreshCurrentTabs();
        render();
      });
    } catch {}
  }
  m.onFocus?.((focused) => {
    if (focused) refreshCurrentTabs().then(() => !S.renaming && !S.pane && render());
  });
  store.hub("hello", { role: "panel" });

  // A request tab may have asked for the environments or a reveal while this
  // panel was still loading.
  const pending = await store.sget("ui:pending", null);
  if (pending && Date.now() - (pending.at || 0) < 10000) onBus(pending);
  else if (pending) store.sdel("ui:pending");

  // keep "2m ago" fresh
  setInterval(() => {
    if (!S.pane && !S.renaming && !S.drag && !menuOpen() && S.prefs.sections.history !== false) {
      $$(".hist-row .row-time").forEach((el) => {
        const h = S.history.find((x) => x.id === el.closest(".row").dataset.id);
        if (h) el.textContent = relTime(h.at);
      });
    }
  }, 30000);
}

boot().catch((e) => {
  console.error("[rest] sidebar failed to start", e);
  document.body.innerHTML = `<p style="padding:20px">The REST sidebar couldn't start: ${esc(e?.message || e)}</p>`;
});
