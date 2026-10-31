export function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readString(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeString(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

export function keysWithPrefix(prefix) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) out.push(key);
    }
  } catch {}
  return out;
}

export function boundedMap(key, limit) {
  const load = () => new Map(readJson(key, []).filter((entry) => Array.isArray(entry) && typeof entry[0] === "string"));
  return {
    get(name) {
      return load().get(name);
    },
    set(name, value) {
      const map = load();
      map.delete(name);
      map.set(name, value);
      writeJson(key, [...map].slice(-limit));
    },
    delete(name) {
      const map = load();
      if (map.delete(name)) writeJson(key, [...map]);
    },
  };
}
