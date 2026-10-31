// The file tree as data: folder listings as the host returned them, which
// folders are open, and the flattened list of visible rows. No DOM and no
// `muxy` calls, so it is unit-tested directly (tests/tree-model.test.mjs).
//
// Paths are project-relative; folders end in "/" and the root is "".

import { basename, depth_of, dir_path, is_within, parent_of, strip_slash } from "@/shared/paths";

/** @typedef {{ path: string, name: string, dir: boolean, ignored: boolean, depth: number, draft?: "file" | "folder" }} Entry */

export function entry_from_host(item) {
  const raw = strip_slash(String(item.path ?? ""));
  const dir = Boolean(item.isDirectory);
  const path = dir ? dir_path(raw) : raw;
  return { path, name: item.name ? String(item.name) : basename(raw), dir, ignored: Boolean(item.isIgnored), depth: depth_of(path) - 1 };
}

function same_listing(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].path !== b[i].path || a[i].ignored !== b[i].ignored) return false;
  }
  return true;
}

export class TreeModel {
  constructor() {
    /** @type {Map<string, Entry[]>} folder path -> children, in host order */
    this.children = new Map();
    /** @type {Map<string, Entry>} */
    this.entries = new Map();
    /** @type {Set<string>} */
    this.expanded = new Set();
    /** @type {Entry[]} */
    this.rows = [];
    /** @type {Map<string, number>} path -> index in `rows` */
    this.index = new Map();
    /** Open folders on screen whose listing hasn't been loaded yet. */
    this.missing = [];
    this.draft = null;
  }

  reset() {
    this.children.clear();
    this.entries.clear();
    this.expanded.clear();
    this.rows = [];
    this.index = new Map();
    this.draft = null;
  }

  isLoaded(dir) {
    return this.children.has(dir);
  }

  get(path) {
    return this.entries.get(path) ?? null;
  }

  /**
   * Replaces a folder's listing. Entries that vanished take their loaded
   * subtrees with them. Returns false when nothing changed, so callers can skip
   * a re-render (most `file.changed` events are edits inside a file).
   */
  setChildren(dir, items) {
    // Keep entry identity when nothing about it changed; the view keys its
    // row cache on it.
    const next = items.map((item) => {
      const old = this.entries.get(item.path);
      return old && old.dir === item.dir && old.ignored === item.ignored && old.name === item.name ? old : item;
    });
    const previous = this.children.get(dir);
    if (previous && same_listing(previous, next)) return false;
    if (previous) {
      const keep = new Set(next.map((entry) => entry.path));
      for (const old of previous) if (!keep.has(old.path)) this.removeSubtree(old.path);
    }
    for (const entry of next) this.entries.set(entry.path, entry);
    this.children.set(dir, next);
    return true;
  }

  removeSubtree(path) {
    if (path.endsWith("/")) {
      for (const child of this.children.get(path) ?? []) this.removeSubtree(child.path);
      this.children.delete(path);
      this.expanded.delete(path);
    }
    this.entries.delete(path);
  }

  /** Drops an entry from its parent's listing (an optimistic delete or move). */
  remove(path) {
    const parent = parent_of(path);
    const list = this.children.get(parent);
    if (list) this.children.set(parent, list.filter((entry) => entry.path !== path));
    this.removeSubtree(path);
  }

  /** Inserts an entry into a loaded folder at its sorted position. */
  insert(entry) {
    const parent = parent_of(entry.path);
    const list = this.children.get(parent);
    if (!list || list.some((item) => item.path === entry.path)) return;
    const at = list.findIndex((item) => compare_entries(entry, item) < 0);
    const next = list.slice();
    next.splice(at === -1 ? next.length : at, 0, entry);
    this.children.set(parent, next);
    this.entries.set(entry.path, entry);
  }

  /** Re-keys open folders after a rename or move of `from` to `to`. */
  moveExpanded(from, to) {
    if (!from.endsWith("/")) return;
    for (const dir of [...this.expanded]) {
      if (dir === from || is_within(dir, from)) {
        this.expanded.delete(dir);
        this.expanded.add(to + dir.slice(from.length));
      }
    }
  }

  /**
   * A placeholder row with an inline name field, for New File / New Folder.
   * It sorts first among its kind so it appears where the user is looking.
   */
  setDraft(parent, kind) {
    this.draft = kind ? { path: `${parent}\u0000new`, name: "", dir: kind === "folder", ignored: false, depth: depth_of(parent), draft: kind, parent } : null;
  }

  /**
   * Rebuilds the visible row list. `filter`, when given, is
   * `{ visible(entry), open(entry) }` and replaces the expanded set (used by
   * the changed-files view).
   */
  flatten(filter = null) {
    const rows = [];
    const missing = [];
    const draft = this.draft;
    const walk = (dir) => {
      if (draft && draft.parent === dir) rows.push(draft);
      const list = this.children.get(dir);
      if (!list) {
        missing.push(dir);
        return;
      }
      for (const entry of list) {
        if (filter && !filter.visible(entry)) continue;
        rows.push(entry);
        if (entry.dir && (filter ? filter.open(entry) : this.expanded.has(entry.path))) walk(entry.path);
      }
    };
    walk("");
    this.rows = rows;
    this.missing = missing;
    const index = new Map();
    for (let i = 0; i < rows.length; i += 1) index.set(rows[i].path, i);
    this.index = index;
    return rows;
  }

  indexOf(path) {
    return this.index.get(path) ?? -1;
  }

  /** Whether `path` sits under a folder the host marked as git-ignored. */
  isUnderIgnored(path) {
    // Unlisted folders are skipped: in node_modules/pkg/dist/x.js only
    // node_modules/ is usually known, and it is the one marked ignored.
    for (let dir = parent_of(path); dir !== ""; dir = parent_of(dir)) {
      if (this.entries.get(dir)?.ignored) return true;
    }
    return false;
  }

  /** Loaded folder paths, outermost first. */
  loadedDirs() {
    return [...this.children.keys()].sort((a, b) => depth_of(a) - depth_of(b));
  }
}

// Mirrors the host's listing order (folders first, then lowercased name, then
// raw name) so optimistic inserts land where the next listing will put them.
export function compare_entries(a, b) {
  if (a.dir !== b.dir) return a.dir ? -1 : 1;
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
