import { keysWithPrefix, readJson, removeKey, writeJson } from "@/shared/prefs";

export const TAB_PREFIX = "muxy.git.diff-tab:";
export const REQUEST_KEY = "muxy.git.diff-request";
export const STATE_PREFIX = "muxy.git.diff-state:";
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

export function diffKind(data) {
  const source = data?.source ?? "working";
  return source === "commit" || source === "pr" || source === "range" ? source : "working";
}

export function registeredTabs(root, kind, except = null) {
  const now = Date.now();
  const found = [];
  for (const key of keysWithPrefix(TAB_PREFIX)) {
    const tab = key.slice(TAB_PREFIX.length);
    const entry = readJson(key);
    if (!entry || now - (entry.at ?? 0) > STALE_MS) {
      removeKey(key);
      continue;
    }
    if (tab !== except && entry.root === root && entry.kind === kind) found.push({ tab, at: entry.at ?? 0 });
  }
  return found.sort((a, b) => b.at - a.at);
}

export function forgetTab(tab) {
  removeKey(TAB_PREFIX + tab);
}

export async function sendToTab(tab, data) {
  writeJson(REQUEST_KEY, { tab, data, at: Date.now() });
  try {
    await muxy.tabs.switchTo(tab);
    return true;
  } catch {
    forgetTab(tab);
    return false;
  }
}

const PENDING_PREFIX = "muxy.git.diff-pending:";
const PENDING_MS = 8000;
const opening = new Map();

export function takePending(root, kind) {
  const key = `${PENDING_PREFIX}${root}\n${kind}`;
  const entry = readJson(key);
  removeKey(key);
  return entry && Date.now() - (entry.at ?? 0) < PENDING_MS ? entry.data : null;
}

export async function openDiffTab(root, data) {
  const kind = diffKind(data);
  for (const { tab } of registeredTabs(root, kind)) {
    if (await sendToTab(tab, data)) return;
  }
  const slot = `${root}\n${kind}`;
  if (opening.has(slot)) {
    writeJson(`${PENDING_PREFIX}${slot}`, { data, at: Date.now() });
    return;
  }
  opening.set(slot, true);
  try {
    await muxy.tabs.open({
      kind: "extensionWebView",
      extension: { id: muxy.extensionID, tabType: "diff-viewer", data },
    });
  } finally {
    setTimeout(() => opening.delete(slot), 3000);
  }
}
