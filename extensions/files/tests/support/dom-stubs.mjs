// Minimal localStorage / window stand-ins for modules that coordinate pages
// through localStorage (src/shared/prefs.js, src/shared/editors.js).
export function install_storage() {
  const data = new Map();
  const listeners = new Map();
  globalThis.localStorage = {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  };
  globalThis.window = {
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    dispatchEvent: (event) => {
      for (const fn of listeners.get(event.type) ?? []) fn(event);
      return true;
    },
  };
  globalThis.CustomEvent ??= class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  return { data, listeners };
}
