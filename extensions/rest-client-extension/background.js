// The hub. Muxy delivers a page's `extension.*` message to the background
// script, not to the other pages, so every page sends to `extension.hub` and
// this script answers on `extension.bus`, which all pages listen to.
//
// It also keeps the list of open request tabs. A page knows its own
// tabInstanceID, but `tabs.switchTo` needs the tabID, and only Muxy's tab
// events carry both, so the sidebar gets them from here.

const EXT = "rest-client-extension";
const TAB_TYPE = "request";

const tabs = new Map(); // tabInstanceID -> { inst, tabID, projectID, worktreeID, id, name, method, url, dirty, scratch }
let activeTabID = null;
let pending = null;

function broadcast(msg) {
  try {
    muxy.events.emit("extension.bus", msg);
  } catch (e) {
    console.log(`[rest] emit failed: ${e}`);
  }
}

function publishOpen() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    broadcast({ type: "open", tabs: [...tabs.values()].filter((t) => t.id), active: activeTabID });
  }, 30);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function fromTabEvent(p) {
  if (!p || p.extensionID !== EXT || p.tabTypeID !== TAB_TYPE || !p.tabInstanceID) return null;
  const t = tabs.get(p.tabInstanceID) || { inst: p.tabInstanceID };
  t.tabID = p.tabID;
  t.projectID = p.projectID;
  t.worktreeID = p.worktreeID;
  if (!t.id && p.data) {
    try {
      const data = JSON.parse(p.data);
      if (data && data.id) t.id = String(data.id);
    } catch {}
  }
  tabs.set(t.inst, t);
  return t;
}

function upsert(msg) {
  if (!msg.inst) return null;
  const t = tabs.get(msg.inst) || { inst: msg.inst };
  for (const k of ["id", "name", "method", "url", "dirty", "scratch"]) if (k in msg) t[k] = msg[k];
  tabs.set(t.inst, t);
  return t;
}

muxy.events.subscribe("tab.created", (p) => {
  if (fromTabEvent(p)) publishOpen();
});

muxy.events.subscribe("tab.updated", (p) => {
  if (fromTabEvent(p)) publishOpen();
});

muxy.events.subscribe("tab.closed", (p) => {
  if (p && p.extensionID === EXT && tabs.delete(p.tabInstanceID)) publishOpen();
});

muxy.events.subscribe("tab.focused", (p) => {
  const next = (p && p.tabID) || null;
  if (next === activeTabID) return;
  const wasOurs = [...tabs.values()].some((t) => t.tabID === activeTabID);
  activeTabID = next;
  const isOurs = [...tabs.values()].some((t) => t.tabID === next);
  if (wasOurs || isOurs) publishOpen();
});

muxy.events.subscribe("extension.hub", (msg) => {
  if (!msg || typeof msg !== "object") return;
  switch (msg.type) {
    case "hello": {
      if (msg.role === "tab") {
        const t = upsert(msg);
        // A restored tab keeps its old title, and setting the same title again
        // sends no event, so ask the page to nudge it once to learn its tabID.
        if (t && !t.tabID) broadcast({ type: "need-tab-id", inst: t.inst });
      }
      publishOpen();
      break;
    }
    case "state":
      if (upsert(msg)) publishOpen();
      break;
    case "bye":
      if (tabs.delete(msg.inst)) publishOpen();
      break;
    case "relay":
      if (msg.msg && typeof msg.msg === "object") broadcast(msg.msg);
      break;
    case "new-request":
      openNewRequest();
      break;
  }
});

function openNewRequest() {
  try {
    muxy.tabs.open({
      kind: "extensionWebView",
      extension: { id: EXT, tabType: TAB_TYPE, data: { id: uid(), scratch: true } },
    });
  } catch (e) {
    console.log(`[rest] couldn't open a request tab: ${e}`);
  }
}

muxy.events.subscribe("command.new-request", openNewRequest);

broadcast({ type: "hub-ready" });
