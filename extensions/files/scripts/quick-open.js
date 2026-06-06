// "Go to File" picker (⌘P).
//
// Runs as a runScript command so the shortcut works app-wide — whether or not
// the Files panel is open. Muxy executes this on demand; the modal searches
// natively while we stream rows in via items(emit), and onSelect opens the
// chosen file in our editor tab.
//
// Self-contained: runScript files are loaded verbatim (not bundled), so no
// imports — only the synchronous `muxy` globals.

const SKIP_DIRS = new Set([".git", "node_modules", ".svn", ".hg"]);
const MAX_FILES = 50000;
const EMIT_BATCH = 5000;

function basename(path) {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function strip_slash(path) {
  return path.replace(/\/+$/, "");
}

function to_item(rel) {
  return { id: rel, title: basename(rel), subtitle: rel };
}

// Fast path: one `git ls-files` (tracked + untracked, minus .gitignored). `-z`
// keeps odd paths intact. Returns false when not a git repo / nothing listed.
function emit_git_files(emit) {
  let out = "";
  try {
    const result = muxy.exec(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
    out = (result && result.stdout) || "";
  } catch {
    return false;
  }
  if (!out) return false;

  let batch = [];
  for (const rel of out.split("\0")) {
    if (!rel) continue;
    batch.push(to_item(rel));
    if (batch.length >= EMIT_BATCH) {
      emit(batch);
      batch = [];
    }
  }
  if (batch.length) emit(batch);
  return true;
}

// Fallback for non-git workspaces: a synchronous walk via muxy.files.
function emit_walked_files(emit) {
  const stack = [""];
  let total = 0;

  while (stack.length > 0 && total < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try {
      entries = muxy.files.list(dir) || [];
    } catch {
      entries = [];
    }

    const batch = [];
    for (const entry of entries) {
      if (entry.isIgnored) continue;
      if (entry.isDirectory) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(`${strip_slash(entry.path)}/`);
      } else if (total < MAX_FILES) {
        batch.push(to_item(strip_slash(entry.path)));
        total += 1;
      }
    }
    if (batch.length) emit(batch);
  }
}

muxy.modal.open({
  placeholder: "Go to file…",
  emptyLabel: "No files",
  noMatchLabel: "No matching files",
  items(emit) {
    if (!emit_git_files(emit)) emit_walked_files(emit);
  },
  onSelect(choice) {
    if (!choice) return;
    const extId = (typeof muxy !== "undefined" && muxy.extensionID) || "files";
    try {
      // Reuse the single preview pane like a tree click does. The editor guards
      // against discarding unsaved edits when its preview pane is reused.
      muxy.tabs.open({
        kind: "extensionWebView",
        extension: {
          id: extId,
          tabType: "code-editor",
          singleton: true,
          data: { filePath: choice.id, replaceable: true },
        },
      });
    } catch (err) {
      // Log the actual message (not the Error object, which renders as a stack)
      // so the real reason is visible in the extension log.
      console.error(
        "[quick-open] tabs.open FAILED" +
          " extId=" + String(extId) +
          " muxy.extensionID=" + String(typeof muxy !== "undefined" ? muxy.extensionID : "n/a") +
          " tabType=code-editor file=" + choice.id +
          " error=" + String((err && err.message) || err),
      );
    }
  },
});
