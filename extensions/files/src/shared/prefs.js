// localStorage is shared by every page of the extension (they share the
// muxy-ext://files origin), and a write raises a `storage` event in every
// *other* page. That makes it both the preference store and the cheap
// panel <-> editor channel. Writes are rare by design: nothing here runs per
// keystroke or on a timer.

export function read_json(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function write_json(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function read_string(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function write_string(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function remove_key(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

export function keys_with_prefix(prefix) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) out.push(key);
    }
  } catch {}
  return out;
}

const LOCAL_EVENT = "muxy-files-pref";

/** Notifies listeners in this page too (`storage` only fires in other pages). */
export function announce(key) {
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: key }));
}

/**
 * Calls `callback(key)` when a key equal to `match` (or starting with it, when
 * `prefix` is set) changes in any page. Returns an unsubscribe function.
 */
export function watch_key(match, callback, { prefix = false } = {}) {
  const hit = (key) => key === null || (prefix ? key.startsWith(match) : key === match);
  const onStorage = (event) => {
    if (hit(event.key)) callback(event.key);
  };
  const onLocal = (event) => {
    if (hit(event.detail)) callback(event.detail);
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(LOCAL_EVENT, onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(LOCAL_EVENT, onLocal);
  };
}
