const SKIP_DIRS = new Set([".git", "node_modules", ".svn", ".hg"]);
// Hard ceiling on how many files we index in memory.
const MAX_FILES = 50000;
// How many files we stream into the picker before the user types. On older
// Muxy (no onQuery support) this is the entire searchable set, so keep it
// bounded — dumping the whole repo is what crashes the modal. On new Muxy this
// is just the pre-typing preview; onQuery takes over the moment a query is set.
const INITIAL_LIMIT = 1000;
// Cap on results returned for a single query.
const MAX_RESULTS = 200;

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

// Collect the workspace file list from git (tracked + untracked, respecting
// .gitignore). Returns null when this isn't a git repo or git fails, so the
// caller can fall back to a filesystem walk.
function git_files() {
  let out = "";
  try {
    const result = muxy.exec(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
    out = (result && result.stdout) || "";
  } catch {
    return null;
  }
  if (!out) return null;
  const files = [];
  for (const rel of out.split("\0")) {
    if (rel) files.push(rel);
    if (files.length >= MAX_FILES) break;
  }
  return files.length ? files : null;
}

// Filesystem-walk fallback for non-git workspaces. Mirrors the file tree's
// skip list and honors .gitignore via entry.isIgnored.
function walked_files() {
  const stack = [""];
  const files = [];
  while (stack.length > 0 && files.length < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try {
      entries = muxy.files.list(dir) || [];
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (entry.isIgnored) continue;
      if (entry.isDirectory) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(`${strip_slash(entry.path)}/`);
      } else if (files.length < MAX_FILES) {
        files.push(strip_slash(entry.path));
      }
    }
  }
  return files;
}

// Lazily build and cache the full file index once per modal session. Both
// items() and onQuery() share it, so we walk/shell out at most once.
let file_index = null;
function get_files() {
  if (file_index === null) file_index = git_files() || walked_files();
  return file_index;
}

// Case-insensitive substring match with a relevance score (lower is better).
// We use substring rather than loose subsequence matching because Muxy still
// applies its own native substring filter on top of onQuery results — a
// subsequence-only hit would survive here but get dropped downstream. Scoring
// ranks basename hits above path hits and earlier matches above later ones, so
// "panel" surfaces files named panel before deep paths that merely contain it.
function match_score(path, query) {
  const haystack = path.toLowerCase();
  const idx = haystack.indexOf(query);
  if (idx === -1) return -1;
  const nameStart = haystack.lastIndexOf("/") + 1;
  const inName = idx >= nameStart;
  // Basename matches first (0), then path matches (1000), then by match offset.
  return (inName ? 0 : 1000) + Math.min(idx - (inName ? nameStart : 0), 999);
}

function search(query) {
  const needle = query.toLowerCase();
  const files = get_files();
  const matches = [];
  for (const rel of files) {
    const score = match_score(rel, needle);
    if (score >= 0) matches.push({ rel, score });
  }
  matches.sort((a, b) => a.score - b.score || a.rel.length - b.rel.length);
  return matches.slice(0, MAX_RESULTS).map((m) => to_item(m.rel));
}

muxy.modal.open({
  placeholder: "Go to file…",
  emptyLabel: "No files",
  noMatchLabel: "No matching files",
  // Pre-typing list. Bounded so older Muxy (which filters natively over these
  // and ignores onQuery) never receives the full repo and crashes.
  items(emit) {
    const files = get_files();
    emit(files.slice(0, INITIAL_LIMIT).map(to_item));
  },
  // New Muxy: search the full index on demand as the user types, so a huge
  // repo is never materialized into the modal at once. Older Muxy ignores
  // this key and keeps filtering the items() slice natively.
  onQuery(query) {
    if (!query) return get_files().slice(0, INITIAL_LIMIT).map(to_item);
    return search(query);
  },
  onSelect(choice) {
    if (!choice) return;
    const extId = (typeof muxy !== "undefined" && muxy.extensionID) || "files";
    try {
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
