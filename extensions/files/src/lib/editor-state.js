const STORAGE_KEY = "muxy.files.editor-state";
const STALE_AFTER_MS = 7000;

function now() {
  return Date.now();
}

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
    return;
  }
}

function fresh_registry(registry, timestamp = now()) {
  let changed = false;
  const fresh = {};
  for (const [id, record] of Object.entries(registry)) {
    if (timestamp - record.updatedAt > STALE_AFTER_MS) {
      changed = true;
      continue;
    }
    fresh[id] = record;
  }
  if (changed) write_registry(fresh);
  return fresh;
}

export function create_editor_state_id() {
  return globalThis.crypto?.randomUUID?.() ?? `editor-${now()}-${Math.random().toString(36).slice(2)}`;
}

export function write_editor_state(id, snapshot) {
  const registry = fresh_registry(read_registry());
  registry[id] = { ...snapshot, updatedAt: now() };
  write_registry(registry);
}

export function clear_editor_state(id) {
  const registry = read_registry();
  if (!(id in registry)) return;
  delete registry[id];
  write_registry(registry);
}

export function has_dirty_replaceable_editor_for_other_file(filePath) {
  const records = Object.values(fresh_registry(read_registry()));
  return records.some((record) => record.replaceable && record.dirty && record.filePath !== filePath);
}
