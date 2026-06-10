const STORAGE_KEY = "muxy.files.cursor-state";
const MAX_ENTRIES = 200;

function read_registry() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write_registry(registry) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
  } catch {
  }
}

function prune(registry) {
  const keys = Object.keys(registry);
  if (keys.length <= MAX_ENTRIES) return registry;
  keys
    .sort((a, b) => (registry[a].updatedAt ?? 0) - (registry[b].updatedAt ?? 0))
    .slice(0, keys.length - MAX_ENTRIES)
    .forEach((key) => delete registry[key]);
  return registry;
}

export function read_cursor_state(filePath) {
  if (!filePath) return null;
  const record = read_registry()[filePath];
  if (!record || typeof record.anchor !== "number" || typeof record.head !== "number") return null;
  return {
    anchor: record.anchor,
    head: record.head,
    scrollTop: typeof record.scrollTop === "number" ? record.scrollTop : 0,
  };
}

export function write_cursor_state(filePath, state) {
  if (!filePath || !state) return;
  const registry = read_registry();
  registry[filePath] = {
    anchor: state.anchor,
    head: state.head,
    scrollTop: state.scrollTop ?? 0,
    updatedAt: Date.now(),
  };
  write_registry(prune(registry));
}
