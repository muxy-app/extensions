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
};

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;

export const AUTO_SAVE_DELAY_MS = 1000;

const STORAGE_KEY = "muxy.files.editor.config";
const SYNC_EVENT = "muxy-files-editor-config";

export function load_editor_config() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function save_editor_config(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new Event(SYNC_EVENT));
  } catch {
    return;
  }
}

export function update_editor_config(current, patch) {
  const next = { ...current, ...patch };
  save_editor_config(next);
  return next;
}

export function subscribe_editor_config(callback) {
  const reload = (event) => {
    if (event?.type === "storage" && event.key !== null && event.key !== STORAGE_KEY) return;
    callback(load_editor_config());
  };
  window.addEventListener("storage", reload);
  window.addEventListener(SYNC_EVENT, reload);
  return () => {
    window.removeEventListener("storage", reload);
    window.removeEventListener(SYNC_EVENT, reload);
  };
}
