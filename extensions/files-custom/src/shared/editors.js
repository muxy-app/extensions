// Coordination between the files panel, the editor tabs, and the palette
// scripts, so a file opens in *one* tab:
//
// - Every editor tab registers `{ root, path, since }` under its pane ID, in
//   localStorage (read synchronously by pages) and in `muxy.storage` (the only
//   store `runScript` palette scripts can read).
// - Openers look up an editor for the same root + path and focus its pane with
//   `tabs.switchTo(paneID)`; only when none answers do they open a new tab.
// - A line/column for an existing tab travels through `muxy.storage` under
//   GOTO_KEY; the editor picks it up when its pane gains focus.
// - The focused editor publishes its path under ACTIVE_KEY so the panel can
//   reveal it.
// - Tab reuse (like an IDE's preview tab): a tab whose file hasn't been edited
//   is a "preview". Opening another file asks the most recently used preview
//   tab to show it instead (REPLACE_KEY); the tab answers from its own current
//   state, and only a yes keeps the opener from opening a new tab.
//
// The root is part of every key because `tabs.switchTo` also searches other
// projects' tabs, and two projects often share relative paths.

import { keys_with_prefix, read_json, remove_key, watch_key, write_json } from "@/shared/prefs";
import { strip_slash } from "@/shared/paths";

export const TAB_TYPE = "code-editor";
export const ENTRY_PREFIX = "muxy.files.editor:";
export const ACTIVE_KEY = "muxy.files.active-editor";
export const MOVED_KEY = "muxy.files.moved";
const PING_KEY = "muxy.files.editor-ping";
const PONG_PREFIX = "muxy.files.editor-pong:";
export const STORE_PREFIX = "editor:";
export const GOTO_KEY = "goto";
const GOTO_TTL_MS = 10_000;
const REPLACE_KEY = "muxy.files.replace";
const REPLACE_ACK_PREFIX = "muxy.files.replace-ack:";
const REPLACE_TTL_MS = 2000;
export const KEEP_KEY = "muxy.files.keep";
/** Per-pane `{ base, path, kept }`: what a tab shows after replacing its file. */
export const TAB_STATE_PREFIX = "muxy.files.tab:";
// The editor settings (src/editor/config.js); the panel reads one field.
const EDITOR_CONFIG_KEY = "muxy.files.editor.config";
const STALE_MS = 14 * 24 * 60 * 60 * 1000;

let rootPromise = null;
// Tabs this page just opened, by root + path: a new editor registers only
// once its page has loaded, so a quick second open must not open another.
const recent = new Map();
const RECENT_MS = 5000;

/**
 * The absolute folder `muxy.files` paths are relative to. `exec` runs in the
 * view's project folder, so `pwd` answers it without extra permissions.
 */
export function project_root({ fresh = false } = {}) {
  if (fresh || !rootPromise) {
    rootPromise = muxy
      .exec(["pwd"])
      .then((res) => (res?.exitCode === 0 ? strip_slash(res.stdout.trim()) || null : null))
      .catch(() => null);
  }
  return rootPromise;
}

function entries() {
  const now = Date.now();
  const out = [];
  for (const key of keys_with_prefix(ENTRY_PREFIX)) {
    const entry = read_json(key);
    const pane = key.slice(ENTRY_PREFIX.length);
    if (!entry || typeof entry.path !== "string" || now - (entry.at ?? 0) > STALE_MS) {
      remove_key(key);
      continue;
    }
    out.push({ ...entry, pane });
  }
  return out;
}

/** Live-looking editor panes for `path` under `root`, most recently used first. */
export function editors_for(root, path) {
  if (!root) return [];
  return entries()
    .filter((entry) => entry.root === root && entry.path === path)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

/** Pane IDs of every registered editor in `root`, keyed by path. */
export function open_paths(root) {
  const map = new Map();
  for (const entry of entries()) if (entry.root === root) map.set(entry.path, entry.pane);
  return map;
}

export function watch_editors(callback) {
  return watch_key(ENTRY_PREFIX, callback, { prefix: true });
}

/** Whether opening a file may replace the current preview tab (the default). */
export function reuse_tabs() {
  return read_json(EDITOR_CONFIG_KEY)?.reuseTab !== false;
}

/** The most recently used editor in `root`, when it is an unedited preview. */
export function reusable_editor(root, except = null) {
  const active = read_json(ACTIVE_KEY);
  if (!root || !active || active.root !== root || !active.preview || active.pane === except) return null;
  return read_json(ENTRY_PREFIX + active.pane) ? active.pane : null;
}

/**
 * Asks editor `pane` to show `path` in place of its file. Resolves true only
 * when that tab confirms; a tab that was edited, closed, or never answers
 * leaves the caller to open a new tab.
 */
export function request_replace(pane, path, position = null, timeoutMs = 400) {
  const nonce = `${muxy.tabInstanceID ?? "x"}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    const done = (ok) => {
      clearTimeout(timer);
      stop();
      remove_key(REPLACE_ACK_PREFIX + nonce);
      resolve(ok);
    };
    const stop = watch_key(REPLACE_ACK_PREFIX + nonce, () => {
      const ack = read_json(REPLACE_ACK_PREFIX + nonce);
      if (ack) done(ack.ok === true);
    });
    const timer = setTimeout(() => done(false), timeoutMs);
    write_json(REPLACE_KEY, { nonce, pane, path, position, at: Date.now() });
  });
}

/** Turns the editor showing `path` from a preview into a kept tab. */
export function keep_editor(root, path) {
  if (root) write_json(KEEP_KEY, { root, path, at: Date.now() });
}

/**
 * Shows `path`: focuses the tab already showing it, else reuses the current
 * preview tab (unless the user turned tab reuse off), else opens a new tab.
 * `position` ({ line, column }) is applied either way.
 */
export async function open_file(path, position = null, { reuse = reuse_tabs() } = {}) {
  const root = await project_root();
  const key = `${root}|${path}`;
  const pending = recent.get(key);
  if (pending && Date.now() - pending.at < RECENT_MS && editors_for(root, path).length === 0) {
    try {
      await muxy.tabs.switchTo(pending.tab);
      return;
    } catch {
      recent.delete(key);
    }
  }
  for (const { pane } of editors_for(root, path)) {
    try {
      if (position?.line) await muxy.storage.set(GOTO_KEY, { pane, ...position, at: Date.now() });
      await muxy.tabs.switchTo(pane);
      return;
    } catch {
      // Closed without unregistering (e.g. the app quit): forget it.
      remove_key(ENTRY_PREFIX + pane);
      void muxy.storage.delete(STORE_PREFIX + pane).catch(() => undefined);
    }
  }
  const target = reuse ? reusable_editor(root) : null;
  if (target && (await request_replace(target, path, position))) {
    await muxy.tabs.switchTo(target).catch(() => undefined);
    return;
  }
  const data = { filePath: path };
  if (position?.line) Object.assign(data, position);
  const tab = await muxy.tabs.open({
    kind: "extensionWebView",
    extension: { id: muxy.extensionID, tabType: TAB_TYPE, data },
  });
  if (typeof tab === "string" && tab) recent.set(key, { tab, at: Date.now() });
}

/**
 * Tells editor tabs that `from` (a file, or a folder ending in "/") is now
 * `to`, so a tab showing it keeps saving to the right place.
 */
export function announce_move(root, from, to) {
  if (root) write_json(MOVED_KEY, { root, from, to, at: Date.now() });
}

/** Where `path` lives after `move` ({ from, to }), or null if it didn't move. */
export function moved_path(path, move) {
  if (!path || !move || typeof move.from !== "string" || typeof move.to !== "string") return null;
  if (move.from === path) return move.to;
  if (move.from.endsWith("/") && path.startsWith(move.from)) return move.to + path.slice(move.from.length);
  return null;
}

// ---- Editor side -----------------------------------------------------------

export class EditorRegistration {
  constructor() {
    this.pane = muxy.tabInstanceID;
    this.root = null;
    this.path = null;
    this.since = Date.now();
    this.preview = true;
    this.onReplace = null;
    this.onKeep = null;
    this.stops = [
      watch_key(PING_KEY, () => this.answerPing()),
      watch_key(REPLACE_KEY, () => this.answerReplace()),
      watch_key(KEEP_KEY, () => {
        const keep = read_json(KEEP_KEY);
        if (keep && this.root && keep.root === this.root && keep.path === this.path) this.onKeep?.();
      }),
    ];
  }

  /** Records whether this tab is still an unedited preview. */
  setPreview(preview) {
    if (this.preview === preview) return;
    this.preview = preview;
    this.write();
    const active = read_json(ACTIVE_KEY);
    if (active?.pane === this.pane) write_json(ACTIVE_KEY, { ...active, preview });
  }

  answerReplace() {
    const request = read_json(REPLACE_KEY);
    if (!request || request.pane !== this.pane || Date.now() - (request.at ?? 0) > REPLACE_TTL_MS) return;
    const ok = this.onReplace ? this.onReplace(request) === true : false;
    write_json(REPLACE_ACK_PREFIX + request.nonce, { ok });
  }

  async set(path) {
    this.root = await project_root();
    this.path = path;
    this.since = Date.now();
    this.write();
  }

  write() {
    if (!this.root || !this.path) return;
    const entry = { root: this.root, path: this.path, since: this.since, preview: this.preview, at: Date.now() };
    write_json(ENTRY_PREFIX + this.pane, entry);
    void muxy.storage.set(STORE_PREFIX + this.pane, entry).catch(() => undefined);
  }

  /** Marks this tab as the one in use, for reveal-in-tree and tab reuse. */
  activate() {
    if (!this.root || !this.path) return;
    this.write();
    write_json(ACTIVE_KEY, { root: this.root, path: this.path, pane: this.pane, preview: this.preview, at: Date.now() });
  }

  /** The line/column an opener left for this pane, if any. */
  async takeGoto() {
    try {
      const goto = await muxy.storage.get(GOTO_KEY);
      if (!goto || goto.pane !== this.pane || Date.now() - (goto.at ?? 0) > GOTO_TTL_MS) return null;
      await muxy.storage.delete(GOTO_KEY);
      return goto;
    } catch {
      return null;
    }
  }

  /**
   * Asks the other editor tabs whether one already shows this file. Resolves
   * to the pane of an older tab that answers within `timeoutMs`, else null.
   * Only the older tab answers, so two tabs opened together keep exactly one.
   */
  findOlderTwin(timeoutMs = 250) {
    if (!this.root || !this.path) return Promise.resolve(null);
    const nonce = `${this.pane}:${Date.now()}`;
    return new Promise((resolve) => {
      const done = (pane) => {
        clearTimeout(timer);
        stop();
        remove_key(PONG_PREFIX + nonce);
        resolve(pane);
      };
      const stop = watch_key(PONG_PREFIX + nonce, () => {
        const pong = read_json(PONG_PREFIX + nonce);
        if (pong?.pane && pong.pane !== this.pane && pong.since < this.since) done(pong.pane);
      });
      const timer = setTimeout(() => done(null), timeoutMs);
      write_json(PING_KEY, { nonce, root: this.root, path: this.path, pane: this.pane, since: this.since });
    });
  }

  answerPing() {
    const ping = read_json(PING_KEY);
    if (!ping || ping.pane === this.pane || !this.root) return;
    if (ping.root !== this.root || ping.path !== this.path || this.since >= ping.since) return;
    write_json(PONG_PREFIX + ping.nonce, { pane: this.pane, since: this.since });
  }

  dispose() {
    for (const stop of this.stops) stop();
    remove_key(ENTRY_PREFIX + this.pane);
    void muxy.storage.delete(STORE_PREFIX + this.pane).catch(() => undefined);
    const active = read_json(ACTIVE_KEY);
    if (active?.pane === this.pane) remove_key(ACTIVE_KEY);
  }
}
