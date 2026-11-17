// Cursor and scroll position per file, restored when the file opens again.
// Written when the editor pauses, blurs, or closes, never per keystroke.

import { read_json, write_json } from "@/shared/prefs";

const STORAGE_KEY = "muxy.files.cursor-state";
const MAX_ENTRIES = 200;

export function read_cursor_state(filePath) {
  if (!filePath) return null;
  const record = read_json(STORAGE_KEY, {})?.[filePath];
  if (!record || typeof record.anchor !== "number" || typeof record.head !== "number") return null;
  return {
    anchor: record.anchor,
    head: record.head,
    scrollTop: typeof record.scrollTop === "number" ? record.scrollTop : 0,
  };
}

export function write_cursor_state(filePath, state) {
  if (!filePath || !state) return;
  const registry = read_json(STORAGE_KEY, {}) ?? {};
  const previous = registry[filePath];
  if (previous && previous.anchor === state.anchor && previous.head === state.head && previous.scrollTop === state.scrollTop) {
    return;
  }
  registry[filePath] = { anchor: state.anchor, head: state.head, scrollTop: state.scrollTop ?? 0, updatedAt: Date.now() };
  const keys = Object.keys(registry);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => (registry[a].updatedAt ?? 0) - (registry[b].updatedAt ?? 0))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((key) => delete registry[key]);
  }
  write_json(STORAGE_KEY, registry);
}
