import { announce, read_json, watch_key, write_json } from "@/shared/prefs";

export const DEFAULT_CONFIG = {
  fontSize: 13,
  lineNumbers: true,
  wordWrap: false,
  tabSize: 2,
  autocomplete: true,
  codeFolding: true,
  linting: true,
  colorPreview: true,
  treeSitter: true,
  autoSave: true,
  // Open files in the current tab when it hasn't been edited (IDE "preview").
  reuseTab: true,
};

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;
export const AUTO_SAVE_DELAY_MS = 1000;

const STORAGE_KEY = "muxy.files.editor.config";

export function load_editor_config() {
  const stored = read_json(STORAGE_KEY, null);
  return { ...DEFAULT_CONFIG, ...(stored && typeof stored === "object" ? stored : {}) };
}

export function update_editor_config(current, patch) {
  const next = { ...current, ...patch };
  write_json(STORAGE_KEY, next);
  announce(STORAGE_KEY);
  return next;
}

/** Settings are shared by every editor tab; changes apply everywhere at once. */
export function watch_editor_config(callback) {
  return watch_key(STORAGE_KEY, () => callback(load_editor_config()));
}
