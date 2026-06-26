export const ICON_THEMES = ["stroke", "material"];
export const DEFAULT_ICON_THEME = "stroke";

const STORAGE_KEY = "muxy.files.icon-theme";
const SYNC_EVENT = "muxy-files-icon-theme";

export function load_icon_theme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return ICON_THEMES.includes(raw) ? raw : DEFAULT_ICON_THEME;
  } catch {
    return DEFAULT_ICON_THEME;
  }
}

export function save_icon_theme(theme) {
  const next = ICON_THEMES.includes(theme) ? theme : DEFAULT_ICON_THEME;
  try {
    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(SYNC_EVENT));
  } catch {
    return;
  }
}

export function subscribe_icon_theme(callback) {
  const reload = () => callback(load_icon_theme());
  window.addEventListener("storage", reload);
  window.addEventListener(SYNC_EVENT, reload);
  return () => {
    window.removeEventListener("storage", reload);
    window.removeEventListener(SYNC_EVENT, reload);
  };
}
