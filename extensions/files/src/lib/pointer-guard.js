const STORAGE_KEY = "muxy.files.pointer-over-panel";

export function is_pointer_over_panel() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function publish_pointer_over_panel(over) {
  try {
    if (over) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
  }
}

export function watch_pointer_over_panel(callback) {
  const notify = (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    callback(is_pointer_over_panel());
  };
  window.addEventListener("storage", notify);
  callback(is_pointer_over_panel());
  return () => window.removeEventListener("storage", notify);
}
