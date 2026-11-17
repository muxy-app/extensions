// Opening files from palette scripts (runScript), where `muxy.*` calls are
// synchronous and localStorage doesn't exist. Mirrors `open_file` in
// src/shared/editors.js: editor tabs register `{ root, path }` in
// `muxy.storage` under "editor:<paneID>"; an open tab for the same file is
// focused (with a pending line handed over under "goto") instead of opening a
// duplicate.

const STORE_PREFIX = "editor:";
const GOTO_KEY = "goto";
const STALE_MS = 14 * 24 * 60 * 60 * 1000;

export function project_root() {
  try {
    const res = muxy.exec(["pwd"]);
    return res && res.exitCode === 0 ? res.stdout.trim().replace(/\/+$/, "") || null : null;
  } catch {
    return null;
  }
}

function open_editors(root, path) {
  const now = Date.now();
  const found = [];
  let keys = [];
  try {
    keys = muxy.storage.keys();
  } catch {
    return found;
  }
  for (const key of keys) {
    if (!key.startsWith(STORE_PREFIX)) continue;
    let entry = null;
    try {
      entry = muxy.storage.get(key);
    } catch {}
    if (!entry || now - (entry.at || 0) > STALE_MS) {
      forget(key);
      continue;
    }
    if (entry.root === root && entry.path === path) found.push({ pane: key.slice(STORE_PREFIX.length), at: entry.at || 0 });
  }
  return found.sort((a, b) => b.at - a.at);
}

function forget(key) {
  try {
    muxy.storage.delete(key);
  } catch {}
}

/** Focuses the editor tab showing `path`, or opens one. */
export function open_editor(path, position = null) {
  const root = project_root();
  if (root) {
    for (const { pane } of open_editors(root, path)) {
      try {
        if (position && position.line) muxy.storage.set(GOTO_KEY, { pane, line: position.line, column: position.column, at: Date.now() });
        muxy.tabs.switchTo(pane);
        return;
      } catch {
        forget(STORE_PREFIX + pane);
      }
    }
  }
  const data = { filePath: path };
  if (position && position.line) {
    data.line = position.line;
    if (position.column) data.column = position.column;
  }
  muxy.tabs.open({
    kind: "extensionWebView",
    extension: { id: muxy.extensionID || "files", tabType: "code-editor", data },
  });
}
