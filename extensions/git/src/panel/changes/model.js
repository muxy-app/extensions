export const SECTIONS = [
  { id: "conflicts", label: "Merge Conflicts" },
  { id: "staged", label: "Staged Changes" },
  { id: "unstaged", label: "Changes" },
];

function matches(entry, query) {
  return !query || entry.path.toLowerCase().includes(query);
}

function buildTree(entries) {
  const root = { name: "", path: "", dirs: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i];
      let next = node.dirs.get(name);
      if (!next) {
        next = { name, path: node.path ? `${node.path}/${name}` : name, dirs: new Map(), files: [] };
        node.dirs.set(name, next);
      }
      node = next;
    }
    node.files.push(entry);
  }
  return root;
}

function compact(node) {
  let current = node;
  while (current.files.length === 0 && current.dirs.size === 1) {
    const only = current.dirs.values().next().value;
    current = { ...only, name: `${current.name}/${only.name}` };
  }
  return current;
}

function collect(node, out = []) {
  for (const dir of node.dirs.values()) collect(dir, out);
  for (const file of node.files) out.push(file);
  return out;
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

function pushTree(rows, section, node, depth, collapsed) {
  for (const raw of [...node.dirs.values()].sort(byName)) {
    const dir = compact(raw);
    const key = `d:${section}:${dir.path}`;
    const open = !collapsed.has(key);
    rows.push({ type: "folder", key, section, name: dir.name, path: dir.path, depth, open, entries: collect(dir) });
    if (open) pushTree(rows, section, dir, depth + 1, collapsed);
  }
  for (const entry of [...node.files].sort(byName)) rows.push({ type: "file", key: `f:${section}:${entry.path}`, section, entry, depth });
}

export function buildRows(status, { tree = false, filter = "", collapsed = new Set(), sections = SECTIONS } = {}) {
  const rows = [];
  if (!status) return rows;
  const query = filter.trim().toLowerCase();
  for (const section of sections) {
    const entries = (status[section.id] ?? []).filter((entry) => matches(entry, query));
    if (entries.length === 0) continue;
    const key = `s:${section.id}`;
    const open = !collapsed.has(key);
    rows.push({ type: "section", key, section: section.id, label: section.label, count: entries.length, open, entries });
    if (!open) continue;
    if (tree) pushTree(rows, section.id, buildTree(entries), 0, collapsed);
    else for (const entry of entries) rows.push({ type: "file", key: `f:${section.id}:${entry.path}`, section: section.id, entry, depth: 0 });
  }
  return rows;
}

export function selectedEntries(rows, keys) {
  const out = [];
  for (const row of rows) if (row.type === "file" && keys.has(row.key)) out.push(row);
  return out;
}

export function visibleCollapsed(collapsed, showSectionHeaders) {
  return showSectionHeaders ? collapsed : new Set([...collapsed].filter((key) => !key.startsWith("s:")));
}
