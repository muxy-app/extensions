import {
  EditorView, EditorState, Compartment, keymap,
  lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  highlightSpecialChars, foldGutter, foldKeymap, bracketMatching, indentOnInput,
  syntaxHighlighting, HighlightStyle, defaultKeymap, historyKeymap,
  searchKeymap, highlightSelectionMatches, tags as t, languageFor,
  Decoration, WidgetType, gutter, GutterMarker,
  StateField, StateEffect, RangeSet,
} from '../lib/codemirror.js';
import { FileTree } from '../lib/trees.js';
import { renderMarkdown } from '../lib/markdown.js';

/* ------------------------------------------------------------------ utils */
const $ = (id) => document.getElementById(id);
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Single-quote a string for POSIX sh (close, escape the quote, reopen).
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// Short SHA-256 hex; used for the per-project store filename and per-(file,line)
// comment ids. Falls back to FNV-1a if SubtleCrypto is somehow unavailable (it
// is present under the muxy-asset:// origin).
async function hashHex(input, len = 16) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
  } catch {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0').slice(0, len);
  }
}
function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

/* ----------------------------------------------------- least-privilege exec
 * All shell access goes through exactly TWO fixed proxy scripts: one that
 * LISTS a directory and one that READS a file. Muxy keys its "Allow & remember"
 * exec rule on the exact command line, so:
 *   - The variable inputs (directory, file, mode) travel via ENVIRONMENT, never
 *     the command, keeping each command line constant → one approval each.
 *   - That single approval is bound to THIS exact script text. A compromised
 *     tab cannot run anything else without triggering a fresh consent prompt,
 *     so the granted capability is precisely "list a dir" and "read a file in
 *     a dir" — nothing more. (Safer than on-disk scripts, which could be
 *     swapped after approval while keeping the same `sh script.sh` rule.)
 * The read proxy additionally refuses absolute paths and `..` traversal, so
 * reads are confined to the given directory.
 */
const SEP = '__MUXY_REVIEW_SECTION__';

// The empty-tree object: a synthetic "parent" for the ROOT commit (which has no
// real parent), so its whole content reads as added rather than erroring.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const LIST_SCRIPT = [
  'PATH="${PATH:-/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin}"; export PATH',
  'cd -- "$REVIEW_ROOT" 2>/dev/null || exit 1',
  // REVIEW_REF (optional) selects a historical commit to review instead of the
  // working tree. It only ever carries a commit SHA, so refuse anything non-hex —
  // keeping the granted capability to "list/diff a commit in this repo".
  'case "$REVIEW_REF" in "") ;; *[!0-9a-fA-F]*) echo "review: bad ref" 1>&2; exit 2;; esac',
  'if [ -n "$REVIEW_REF" ]; then',
  // Reviewing one commit: list/diff it against its FIRST parent (sensible for a
  // merge); the root commit has no parent → diff against the empty tree. Changed
  // = the files it touched (excluding deletions, no content to open); All = the
  // whole tree as of that commit. The status slot is name-status (mapped to the
  // same badges as porcelain); the branch slot is the commit's short sha.
  `  if git rev-parse -q --verify "$REVIEW_REF^" >/dev/null 2>&1; then par="$REVIEW_REF^"; else par=${EMPTY_TREE}; fi`,
  '  if [ "$REVIEW_MODE" = changed ]; then',
  '    git diff --name-only --diff-filter=d "$par" "$REVIEW_REF" 2>/dev/null',
  '  else',
  '    git ls-tree -r --name-only "$REVIEW_REF" 2>/dev/null',
  '  fi',
  '  printf "%s\\n" "$REVIEW_SEP"',
  '  git diff --name-status --diff-filter=d "$par" "$REVIEW_REF" 2>/dev/null',
  '  printf "%s\\n" "$REVIEW_SEP"',
  '  git log -1 --no-color --pretty=%h "$REVIEW_REF" 2>/dev/null',
  '  exit 0',
  'fi',
  'if [ "$REVIEW_MODE" = changed ]; then',
  // Changed = added + modified (staged or not), excluding deletions (lowercase
  // d in --diff-filter excludes them — they have no file to open). `git diff
  // HEAD` covers staged AND unstaged tracked changes; ls-files --others adds
  // brand-new untracked files. The two sets are disjoint. Falls back to a
  // HEAD-less diff in a repo with no commits yet.
  '  if git rev-parse --verify -q HEAD >/dev/null 2>&1; then',
  '    git diff --name-only --diff-filter=d HEAD 2>/dev/null',
  '  else',
  '    git diff --name-only --diff-filter=d 2>/dev/null',
  '  fi',
  '  git ls-files --others --exclude-standard 2>/dev/null',
  'else',
  "  find . -type f -not -path './.git/*'",
  'fi',
  'printf "%s\\n" "$REVIEW_SEP"',
  'git status --porcelain 2>/dev/null',
  'printf "%s\\n" "$REVIEW_SEP"',
  'git rev-parse --abbrev-ref HEAD 2>/dev/null',
].join('\n');

const READ_SCRIPT = [
  'PATH="${PATH:-/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin}"; export PATH',
  'case "$REVIEW_FILE" in',
  '  ""|/*|..|../*|*/..|*/../*) echo "review: refused path" 1>&2; exit 2;;',
  'esac',
  'case "$REVIEW_REF" in "") ;; *[!0-9a-fA-F]*) echo "review: bad ref" 1>&2; exit 2;; esac',
  // With a ref, read the file AS OF that commit (git show <sha>:<path>); without
  // one, read the working-tree copy. The `<rev>:<path>` form is repo-root-relative,
  // matching the paths the tree hands us.
  'if [ -n "$REVIEW_REF" ]; then',
  '  exec git -C "$REVIEW_ROOT" show "$REVIEW_REF:$REVIEW_FILE"',
  'fi',
  'exec cat -- "$REVIEW_ROOT/$REVIEW_FILE"',
].join('\n');

// Invoke a proxy. muxy.exec appends a trailing NUL terminator to stdout; strip
// it so it neither corrupts the last parsed line nor trips binary detection.
async function runProxy(script, env) {
  try {
    const res = await muxy.exec({ argv: ['sh', '-c', script], env });
    const stdout = typeof res?.stdout === 'string' ? res.stdout.replace(/\u0000+$/, '') : '';
    return { exitCode: res?.exitCode ?? -1, stdout, stderr: res?.stderr || '' };
  } catch (err) {
    return { exitCode: -1, stdout: '', stderr: String(err) };
  }
}

// List the active directory in the given mode; returns files + raw `git status`
// porcelain + branch in one approved call.
async function runList(mode) {
  const res = await runProxy(LIST_SCRIPT, {
    REVIEW_ROOT: state.root || '.', REVIEW_MODE: mode, REVIEW_SEP: SEP,
    REVIEW_REF: state.ref || '',
  });
  const [filesB = '', statusB = '', branchB = ''] = res.stdout.split(SEP);
  // `changed` mode concatenates two git outputs (diff + ls-files); they're
  // disjoint, but dedupe defensively before sorting.
  const files = [...new Set(lines(filesB).map((p) => p.replace(/^\.\//, '')))].sort();
  return { files, status: statusB, branch: branchB.trim() };
}

async function runRead(path) {
  return runProxy(READ_SCRIPT, {
    REVIEW_ROOT: state.root || '.', REVIEW_FILE: path, REVIEW_REF: state.ref || '',
  });
}

// A FIFTH fixed proxy (same least-privilege rule as LIST/READ/DIFF/STORE): the
// recent commit history that feeds the review-ref picker. A fixed `--pretty=format`
// keeps the command line constant; fields are separated by the unit-separator byte
// (%x1f) so a subject containing any other punctuation parses cleanly.
const LOG_SCRIPT = [
  'PATH="${PATH:-/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin}"; export PATH',
  'cd -- "$REVIEW_ROOT" 2>/dev/null || exit 1',
  "git log --no-color --max-count=500 --pretty=format:'%H%x1f%h%x1f%an%x1f%ar%x1f%s' 2>/dev/null",
].join('\n');

// Parse the log proxy into [{ sha, short, author, date, subject }] (newest first).
async function runLog() {
  const res = await runProxy(LOG_SCRIPT, { REVIEW_ROOT: state.root || '.' });
  const out = [];
  for (const row of res.stdout.split('\n')) {
    if (!row) continue;
    const [sha, short, author, date, ...rest] = row.split('\u001f');
    if (!sha) continue;
    out.push({ sha, short, author, date, subject: rest.join('\u001f') });
  }
  return out;
}

// A FOURTH fixed proxy, same least-privilege rule as LIST/READ/STORE: emit the
// unified `git diff` for ONE file so the editor can paint added (green) lines
// and removed (red) lines inline. Zero context (`-U0`) keeps hunks tight so the
// parser only ever sees changed lines. Tracked changes come from `git diff HEAD`
// (staged + unstaged); a file git doesn't track yet (untracked / brand-new) has
// no HEAD blob, so we synthesize an all-added diff with `git diff --no-index`
// against /dev/null. Refuses absolute paths and `..` traversal like READ_SCRIPT,
// so it stays confined to the project root → one "Allow & remember".
const DIFF_SCRIPT = [
  'PATH="${PATH:-/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin}"; export PATH',
  'case "$REVIEW_FILE" in',
  '  ""|/*|..|../*|*/..|*/../*) echo "review: refused path" 1>&2; exit 2;;',
  'esac',
  'case "$REVIEW_REF" in "") ;; *[!0-9a-fA-F]*) echo "review: bad ref" 1>&2; exit 2;; esac',
  'cd -- "$REVIEW_ROOT" 2>/dev/null || exit 1',
  // Reviewing a commit: diff it against its first parent (root commit → empty
  // tree). The new-file side is the commit, which is exactly the content READ
  // shows via `git show`, so the parsed line numbers line up.
  'if [ -n "$REVIEW_REF" ]; then',
  `  if git rev-parse -q --verify "$REVIEW_REF^" >/dev/null 2>&1; then par="$REVIEW_REF^"; else par=${EMPTY_TREE}; fi`,
  '  git diff --no-color --no-ext-diff -U0 "$par" "$REVIEW_REF" -- "$REVIEW_FILE" 2>/dev/null',
  '  exit 0',
  'fi',
  'if git ls-files --error-unmatch -- "$REVIEW_FILE" >/dev/null 2>&1; then',
  '  if git rev-parse --verify -q HEAD >/dev/null 2>&1; then',
  '    git diff --no-color --no-ext-diff -U0 HEAD -- "$REVIEW_FILE" 2>/dev/null',
  '  else',
  '    git diff --no-color --no-ext-diff -U0 -- "$REVIEW_FILE" 2>/dev/null',
  '  fi',
  'else',
  '  git diff --no-color --no-ext-diff -U0 --no-index -- /dev/null "$REVIEW_FILE" 2>/dev/null',
  'fi',
].join('\n');

async function runDiff(path) {
  return runProxy(DIFF_SCRIPT, {
    REVIEW_ROOT: state.root || '.', REVIEW_FILE: path, REVIEW_REF: state.ref || '',
  });
}

// Parse a `-U0` unified diff into per-(new-file) line classification:
//   added     — Set of new-file line numbers that are `+` lines (paint green).
//   deletions — Map<newLineNo, string[]> of removed line texts, anchored to the
//               new-file line they sit ABOVE (a block widget renders them there).
// A modification (`-old` then `+new`) yields both: the new line is `added`, and
// the old text is a deletion anchored to that same line (red block above green).
// Pure trailing deletions anchor past doc end; the deco builder clamps them to
// render after the last line.
function parseDiff(text) {
  const added = new Set();
  const deletions = new Map();
  if (!text) return { added, deletions };
  let newLine = 0;
  let pendingDel = [];
  const flushDel = (at) => {
    if (!pendingDel.length) return;
    deletions.set(at, (deletions.get(at) || []).concat(pendingDel));
    pendingDel = [];
  };
  for (const row of text.split('\n')) {
    if (row.startsWith('+++') || row.startsWith('---')) continue; // file headers
    if (row.startsWith('@@')) {
      flushDel(newLine); // close out the previous hunk's trailing deletions
      const m = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(row);
      if (m) {
        const start = parseInt(m[1], 10);
        const count = m[2] === undefined ? 1 : parseInt(m[2], 10);
        // count 0 = pure deletion: `start` is the line the removal FOLLOWS, so
        // anchor the widget before start+1; otherwise the hunk's first new line.
        newLine = count === 0 ? start + 1 : start;
      }
      continue;
    }
    if (row.startsWith('-')) { pendingDel.push(row.slice(1)); continue; }
    if (row.startsWith('+')) { flushDel(newLine); added.add(newLine); newLine++; continue; }
    flushDel(newLine); newLine++; // context line (only with >0 context)
  }
  flushDel(newLine);
  return { added, deletions };
}

/* One MORE fixed proxy for the comments feature, same least-privilege rule.
 *
 * STORE_SCRIPT — read/write the per-project comments JSON and stage a launch
 * prompt, all under ~/.config/muxy/review/ (OUTSIDE any repo, so review state
 * is never committed). The variable filename is a hex digest passed via env;
 * the script refuses anything non-hex, so the granted capability is exactly
 * "read/write hex-named files in that one directory" — nothing else, one
 * "Allow & remember".
 *
 * (Agent targeting needs no shell: the send menu just lists `panes.list()`,
 * which already carries each pane's workingDirectory + title.)
 */
const STORE_SCRIPT = [
  'PATH="${PATH:-/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin}"; export PATH',
  'dir="$HOME/.config/muxy/review"',
  'case "$REVIEW_KEY" in ""|*[!0-9a-f]*) echo "review: bad key" 1>&2; exit 2;; esac',
  'f="$dir/$REVIEW_KEY.json"; p="$dir/$REVIEW_KEY.prompt"',
  'case "$REVIEW_OP" in',
  '  write) mkdir -p "$dir"; printf "%s" "$REVIEW_CONTENT" > "$f.tmp" && mv -f "$f.tmp" "$f";;',
  '  prompt) mkdir -p "$dir"; printf "%s" "$REVIEW_CONTENT" > "$p.tmp" && mv -f "$p.tmp" "$p";;',
  '  read) cat -- "$f" 2>/dev/null || true;;',
  '  *) echo "review: bad op" 1>&2; exit 2;;',
  'esac',
].join('\n');

async function runStore(op, { content } = {}) {
  return runProxy(STORE_SCRIPT, {
    REVIEW_KEY: state.storeKey || '', REVIEW_OP: op, REVIEW_CONTENT: content || '',
  });
}

// Map `git status --porcelain` to @pierre/trees GitStatusEntry[].
function parseGitStatus(porcelain) {
  const entries = [];
  for (const raw of porcelain.split('\n')) {
    if (raw.length < 4) continue;
    const xy = raw.slice(0, 2);
    let path = raw.slice(3);
    if (xy === '??') { entries.push({ path, status: 'untracked' }); continue; }
    if (xy.includes('R')) {
      const arrow = path.indexOf(' -> ');
      if (arrow >= 0) path = path.slice(arrow + 4);
      entries.push({ path, status: 'renamed' });
      continue;
    }
    const code = xy.trim();
    if (code.includes('D')) entries.push({ path, status: 'deleted' });
    else if (code.includes('A')) entries.push({ path, status: 'added' });
    else if (code.includes('M') || code.includes('U') || code.includes('T'))
      entries.push({ path, status: 'modified' });
  }
  return entries;
}

// Map `git diff --name-status` (used when reviewing a specific commit) to the same
// GitStatusEntry[] shape as parseGitStatus. Lines look like `M\tpath`, `A\tpath`,
// or `R100\told\tnew` — the LAST tab field is always the (new) path.
function parseNameStatus(text) {
  const entries = [];
  for (const raw of (text || '').split('\n')) {
    if (!raw) continue;
    const parts = raw.split('\t');
    const path = parts[parts.length - 1];
    const c = (parts[0] || '')[0];
    if (!path) continue;
    if (c === 'A') entries.push({ path, status: 'added' });
    else if (c === 'D') entries.push({ path, status: 'deleted' });
    else if (c === 'R' || c === 'C') entries.push({ path, status: 'renamed' });
    else if (c === 'M' || c === 'T' || c === 'U') entries.push({ path, status: 'modified' });
  }
  return entries;
}

// Extensions we never try to render as text.
const BINARY_EXT = new Set([
  'png','jpg','jpeg','gif','bmp','ico','webp','tiff','avif','heic',
  'pdf','zip','gz','tgz','bz2','xz','7z','rar','jar','war',
  'mp3','wav','flac','ogg','m4a','aac','mp4','mov','avi','mkv','webm',
  'woff','woff2','ttf','otf','eot','wasm','class','o','a','so','dylib',
  'dll','exe','bin','dat','db','sqlite','sqlite3','psd','sketch','fig',
]);
const extOf = (p) => {
  const base = p.split('/').pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
};

// File types that can be shown as a rendered preview (in addition to the
// CodeMirror source view). Returns the renderer kind, or null for "source only".
function previewKind(path) {
  const e = extOf(path);
  if (e === 'md' || e === 'markdown' || e === 'mdx') return 'markdown';
  if (e === 'html' || e === 'htm' || e === 'xhtml') return 'html';
  return null;
}

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------------ state */
const state = {
  root: null,
  scope: 'all',
  ref: null,          // null = working tree (today's behavior); else a commit SHA being reviewed
  branch: null,       // current branch name (for the "Working tree" picker label)
  commits: [],        // recent `git log` entries feeding the ref picker [{ sha, short, author, date, subject }]
  files: new Set(),   // current relative file paths in the tree
  dirs: new Set(),    // every directory path implied by `files`
  changedSet: new Set(), // paths git reports as added/modified/untracked (have a diff)
  diffHunks: [],      // sorted start-line numbers of each change hunk in the open file (for ↑/↓ nav)
  current: null,      // relative path of the open file
  currentText: null,  // raw text of the open file (for re-rendering the preview)
  currentKind: null,  // previewKind() of the open file, or null (source only)
  openToken: 0,       // bumped per openFile() so a superseded read never commits/flashes
  restoreFile: null,  // file to pre-select on first tree build (from the saved session)
  view: 'source',     // 'source' | 'preview' — remembered preference
  scriptFiles: new Set(), // HTML files the user opted into running scripts for (this session only)
  scriptsUntil: 0,    // ms timestamp; while in the future, EVERY HTML preview runs scripts (timed window)
  scriptTimer: 0,     // setInterval id ticking the countdown label / revoking scripts on expiry
  tree: null,
  saveTimer: 0,
  sessionSaveTimer: 0, // debounce for persisting open-file + scroll on editor scroll
  storeKey: null,     // sha256(root) — names the per-project comments file
  comments: [],       // [{ id, file, line, snippet, body, createdAt, sentAt }]
  commentSaveTimer: 0,
  commentSeq: 0,            // bumped per write; the in-flight write only clears the guard if it's the latest
  commentWritePending: false, // true while a local write is queued/in-flight — blocks the focus-reload from clobbering it
  // Persisted layout for the two resizable panes (filled from localStorage in
  // init via loadPane). Each is { open, size } — see "pane layout persistence".
  panes: { sidebar: { open: true, size: null, side: 'left' }, comments: { open: false, size: null } },
};

/* ----------------------------------------------------- expansion persistence
 * The tree starts fully COLLAPSED; the user expands folders as they review and
 * we remember which ones stay open so the next visit restores their layout.
 *
 * Where do we store it? Muxy *does* have a per-extension key/value store
 * (`extension.settings.get|set` over the socket), but it is reachable only from
 * the entrypoint (run.sh) — the tab's frozen `window.muxy` bridge exposes no
 * settings/storage surface, and there is no tab→entrypoint channel to relay
 * through. So the tab persists to its own `localStorage`, which is durable here
 * because the tab is served from a stable custom-scheme origin
 * (`muxy-asset://<ext>`). The access goes through this tiny `store` shim, so if
 * localStorage ever proves ephemeral the backend can be swapped (e.g. a third
 * exec proxy that writes a dotfile) without touching the call sites.
 *
 * State is keyed per (root, scope): the "All" and "Changed" trees contain
 * different directory sets, so they remember their open folders independently
 * instead of clobbering each other on every scope switch.
 */
const STORE_PREFIX = 'review:expanded:';
function storeKey() { return `${STORE_PREFIX}${state.scope}:${state.root || '.'}`; }

function loadExpanded() {
  try {
    const raw = localStorage.getItem(storeKey());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch { return []; }
}
function saveExpanded(paths) {
  try { localStorage.setItem(storeKey(), JSON.stringify(paths)); } catch { /* best-effort */ }
}

// The Source/Preview choice is a sticky preference (one value, not per file):
// renderable files default to **Preview**; switch to Source and that sticks
// until you switch back. Persisted to localStorage for the same reasons as tree
// expansion — so the only stored value that overrides the Preview default is an
// explicit 'source' (set the moment the user toggles).
const VIEW_MODE_KEY = 'review:viewmode';
function loadViewMode() {
  try { return localStorage.getItem(VIEW_MODE_KEY) === 'source' ? 'source' : 'preview'; }
  catch { return 'preview'; }
}
function saveViewMode(mode) {
  try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* best-effort */ }
}

// The "enable scripts for the next N minutes" window length is itself a sticky
// preference (the user's customizable amount) — remember the last chosen value so
// the timed-window presets default to it. Persisted like the other prefs; a *timed*
// window and per-file opt-ins are deliberately NOT persisted (a timed grant
// surviving a tab reload would be surprising — and unsafe — so they're session-only).
const SCRIPT_WINDOW_KEY = 'review:scriptwindow';
function loadScriptWindow() {
  const n = parseInt(localStorage.getItem(SCRIPT_WINDOW_KEY) || '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 720) : 10; // default 10m, cap 12h
}
function saveScriptWindow(min) {
  try { localStorage.setItem(SCRIPT_WINDOW_KEY, String(min)); } catch { /* best-effort */ }
}
// "Forever" IS persisted (unlike a timed window): it's an explicit, deliberate
// "always run scripts" choice — like the Source/Preview preference — so it sticks
// across reloads until the user turns it off. The button stays lit and labelled
// "· always" so the standing grant is never a silent surprise.
const SCRIPTS_FOREVER_KEY = 'review:scriptsforever';
function loadScriptsForever() {
  try { return localStorage.getItem(SCRIPTS_FOREVER_KEY) === '1'; } catch { return false; }
}
function saveScriptsForever(on) {
  try {
    if (on) localStorage.setItem(SCRIPTS_FOREVER_KEY, '1');
    else localStorage.removeItem(SCRIPTS_FOREVER_KEY);
  } catch { /* best-effort */ }
}

/* -------------------------------------------------------- pane layout persistence
 * The sidebar (file browser) and the comments drawer each remember whether they
 * are open and what size the user dragged them to. Same localStorage backend and
 * rationale as tree expansion / view mode (durable under the stable
 * `muxy-asset://` origin; swappable behind this shim without touching call sites).
 * Both panes share the core shape — `{ open, size }` — so adding the hide toggle
 * to the sidebar (see `setSidebarOpen`) needed no new storage code. The sidebar
 * additionally carries `side` (`'left' | 'right'`) — which edge it docks to, set
 * from the toggle's right-click menu (see `setSidebarSide`). `size` is a number
 * of px (width for the sidebar, height for the drawer), `null` meaning "use the
 * CSS default". Keyed globally (not per root/scope): pane geometry is a
 * window-chrome preference, the same across every project and scope.
 */
const PANE_PREFIX = 'review:pane:';
const PANE_DEFAULTS = {
  sidebar: { open: true, size: null, side: 'left' }, // size null → CSS width (280px)
  comments: { open: false, size: null },             // size null → CSS height (min(45vh, 360px))
};
function loadPane(name) {
  const fb = PANE_DEFAULTS[name];
  try {
    const v = JSON.parse(localStorage.getItem(PANE_PREFIX + name) || 'null');
    if (!v || typeof v !== 'object') return { ...fb };
    const out = {
      open: typeof v.open === 'boolean' ? v.open : fb.open,
      size: typeof v.size === 'number' && v.size > 0 ? v.size : fb.size,
    };
    // Only the sidebar persists a side; validate against the known edges.
    if ('side' in fb) out.side = v.side === 'left' || v.side === 'right' ? v.side : fb.side;
    return out;
  } catch { return { ...fb }; }
}
function savePane(name) {
  try { localStorage.setItem(PANE_PREFIX + name, JSON.stringify(state.panes[name])); }
  catch { /* best-effort */ }
}

/* ------------------------------------------------------------ session restore
 * Remember the open file, its editor scroll position, and the active scope, so
 * reopening the Review tab (or switching back to it) lands you exactly where you
 * left off — not on the empty placeholder. Same localStorage backend/rationale
 * as the other prefs (durable under the stable `muxy-asset://` origin, swappable
 * behind this shim). Keyed per project ROOT: there is one "current file" per
 * project (like the comments store), and scope is a per-project view choice. The
 * stored scroll is the CodeMirror `scrollDOM.scrollTop`; preview (a sandboxed
 * iframe) has no persistable scroll, so restore targets the Source view.
 */
const SESSION_PREFIX = 'review:session:';
function sessionKey() { return `${SESSION_PREFIX}${state.root || '.'}`; }
function loadSession() {
  try {
    const v = JSON.parse(localStorage.getItem(sessionKey()) || 'null');
    if (!v || typeof v !== 'object') return null;
    return {
      file: typeof v.file === 'string' ? v.file : null,
      scroll: typeof v.scroll === 'number' && v.scroll > 0 ? v.scroll : 0,
      scope: v.scope === 'changed' ? 'changed' : 'all',
      // A reviewed commit SHA (hex), or null for the working tree. Validated against
      // the live `git log` in init before it's honored (a rebased/dropped commit
      // would otherwise strand the user on an empty tree).
      ref: typeof v.ref === 'string' && /^[0-9a-fA-F]+$/.test(v.ref) ? v.ref : null,
    };
  } catch { return null; }
}
function saveSession() {
  try {
    localStorage.setItem(sessionKey(), JSON.stringify({
      file: state.current || null,
      scroll: view ? view.scrollDOM.scrollTop : 0,
      scope: state.scope,
      ref: state.ref || null,
    }));
  } catch { /* best-effort */ }
}
// Coalesce the high-frequency scroll events into one write.
function scheduleSessionSave() {
  clearTimeout(state.sessionSaveTimer);
  state.sessionSaveTimer = setTimeout(saveSession, 200);
}

// Every directory path implied by a file list, e.g. "src/render/x.js" yields
// "src" and "src/render". These are the addressable nodes whose open/closed
// state we track.
function directoriesOf(files) {
  const dirs = new Set();
  for (const f of files) {
    const parts = f.split('/');
    parts.pop(); // drop the filename
    let cur = '';
    for (const p of parts) { cur = cur ? `${cur}/${p}` : p; dirs.add(cur); }
  }
  return dirs;
}

// Which tracked directories are currently expanded, per the live tree. Skips
// paths that don't resolve to a directory handle (e.g. a folder flattened into
// a single-child chain is addressed only by its terminal path).
function currentExpandedDirs() {
  if (!state.tree) return [];
  const out = [];
  for (const d of state.dirs) {
    const item = state.tree.getItem(d);
    if (item && item.isDirectory?.() && item.isExpanded?.()) out.push(d);
  }
  return out;
}

// Debounced persist. `subscribe` fires for any store change (expand/collapse,
// selection, …), so coalesce. Don't persist while a search is active: search
// auto-expands matches, which would pollute the saved layout.
function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    try { if (state.tree?.getSearchValue?.()) return; } catch { /* ignore */ }
    saveExpanded(currentExpandedDirs());
  }, 150);
}

/* --------------------------------------------------------------- codemirror */
const themeCompartment = new Compartment();
const highlightCompartment = new Compartment();
const languageCompartment = new Compartment();
// The diff gutter column is added only for files that actually have removed
// runs, so clean files (and the whole "All" scope) carry no extra left chrome.
const diffGutterCompartment = new Compartment();

// Editor chrome reads live Muxy CSS variables, so it recolors automatically
// on theme change. Only the syntax-token palette is swapped imperatively.
function editorTheme(dark) {
  return EditorView.theme({
    '&': {
      height: '100%',
      color: 'var(--muxy-foreground)',
      backgroundColor: 'var(--muxy-background)',
      fontSize: '12.5px',
    },
    '.cm-content': {
      fontFamily: '"SF Mono", Menlo, Consolas, monospace',
      caretColor: 'var(--muxy-accent)',
      paddingLeft: '6px', // breathing room between the gutter and the code
    },
    '.cm-scroller': { fontFamily: '"SF Mono", Menlo, Consolas, monospace', lineHeight: '1.5' },
    // Gutter blends into the file background — no separate color or divider.
    '.cm-gutters': {
      backgroundColor: 'var(--muxy-background)',
      color: 'var(--muxy-foreground-muted)',
      border: 'none',
    },
    '.cm-lineNumbers .cm-gutterElement': { paddingLeft: '8px', paddingRight: '4px' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muxy-foreground)' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--muxy-accent) 8%, transparent)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--muxy-accent-soft)',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--muxy-surface)',
      border: '1px solid var(--muxy-border)',
      color: 'var(--muxy-foreground-muted)',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--muxy-accent)' },
  }, { dark });
}

// Syntax palettes. Keywords/comments/links lean on Muxy vars (so the accent
// shows through and updates live); literal hues differ per light/dark.
const PALETTES = {
  dark: {
    string: '#98c379', number: '#d19a66', func: '#61afef',
    type: '#e5c07b', prop: '#56b6c2', tag: '#e06c75',
  },
  light: {
    string: '#50a14f', number: '#b76b01', func: '#4078f2',
    type: '#c18401', prop: '#0184bc', tag: '#e45649',
  },
};

function highlightStyle(scheme) {
  const p = PALETTES[scheme] || PALETTES.dark;
  return syntaxHighlighting(HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword],
      color: 'var(--muxy-accent)' },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
      color: 'var(--muxy-foreground-muted)', fontStyle: 'italic' },
    { tag: [t.string, t.special(t.string), t.regexp, t.character], color: p.string },
    { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit], color: p.number },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: p.func },
    { tag: [t.typeName, t.className, t.namespace, t.changed], color: p.type },
    { tag: [t.propertyName, t.attributeName, t.attributeValue], color: p.prop },
    { tag: [t.tagName, t.angleBracket], color: p.tag },
    { tag: [t.variableName, t.labelName, t.self], color: 'var(--muxy-foreground)' },
    { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator],
      color: 'var(--muxy-foreground-muted)' },
    { tag: [t.meta, t.processingInstruction, t.documentMeta], color: 'var(--muxy-foreground-muted)' },
    { tag: [t.link, t.url], color: 'var(--muxy-accent)', textDecoration: 'underline' },
    { tag: t.heading, color: 'var(--muxy-accent)', fontWeight: 'bold' },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: [t.invalid], color: 'var(--muxy-diff-remove)' },
  ]));
}

function baseExtensions(scheme) {
  const dark = scheme === 'dark';
  return [
    // Click a line number to comment on that line; click-drag for a range.
    lineNumbers({ domEventHandlers: lineNumberDragHandlers() }),
    highlightActiveLineGutter(),
    foldGutter(),
    ...diffExtensions(),
    ...commentExtensions(),
    highlightSpecialChars(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap]),
    // Read-only for now. To make the editor writable later, drop these two
    // lines and wire a save path on docChanged.
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    themeCompartment.of(editorTheme(dark)),
    highlightCompartment.of(highlightStyle(scheme)),
    languageCompartment.of([]),
  ];
}

let view;
function ensureEditor() {
  if (view) return view;
  const scheme = muxy.theme?.colorScheme || 'dark';
  view = new EditorView({
    state: EditorState.create({ doc: '', extensions: baseExtensions(scheme) }),
    parent: $('editor-mount'),
  });
  view.scrollDOM.addEventListener('scroll', onEditorScroll, { passive: true });
  wireHoverHint(view);
  return view;
}

// Track which line the pointer is over and publish it to `hoverLineField`, so the
// comment gutter can show a dimmed 💬 "add a comment" hint there. Only dispatches
// on an actual line change (mousemove fires constantly), and clears on leave.
function wireHoverHint(v) {
  let last = 0;
  const set = (line) => {
    if (line === last) return;
    last = line;
    v.dispatch({ effects: setHoverLineEffect.of(line) });
  };
  v.scrollDOM.addEventListener('mousemove', (e) => {
    const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
    set(pos == null ? 0 : v.state.doc.lineAt(pos).number);
  }, { passive: true });
  v.scrollDOM.addEventListener('mouseleave', () => set(0), { passive: true });
}

function setDoc(text, path) {
  const v = ensureEditor();
  v.dispatch({
    changes: { from: 0, to: v.state.doc.length, insert: text },
    effects: languageCompartment.reconfigure(languageFor(path) || []),
    selection: { anchor: 0 },
  });
  v.scrollDOM.scrollTop = 0;
}

// Restore the editor scroll position saved for the reopened file. The doc is set
// synchronously but laid out a measure cycle later, so the target scrollHeight
// isn't final yet — apply inside requestMeasure and retry a few cycles until the
// document is tall enough to honor the offset (large files measure over several
// frames). No-op without a stored offset.
function restoreScroll(top) {
  if (!view || !top) return;
  const apply = (retries) => view.requestMeasure({
    read: () => view.scrollDOM.scrollHeight,
    write: () => {
      view.scrollDOM.scrollTop = top;
      if (view.scrollDOM.scrollTop < top - 1 && retries > 0) apply(retries - 1);
    },
  });
  apply(8);
}

/* =================================================================== comments
 * Click a line number to leave a review comment for a coding agent. Comments
 * are BATCHED — never sent on creation — and persisted to
 * ~/.config/muxy/review/<sha256(root)>.json (outside any repo, so they don't
 * get committed). Pressing "Send to agent" parses that JSON, formats clean
 * markdown, and pushes it into either a freshly-spawned interactive `claude`
 * (a new terminal pane) or an already-running agent pane.
 */

/* ---- canonical store (disk, JSONC) ---- */
// Strip // and /* */ comments, string-aware, so the documented header (and any
// comments an agent leaves) don't break JSON.parse. Also tolerates plain JSON.
function stripJsonc(s) {
  let out = '', i = 0, inStr = false, q = '', esc = false;
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (inStr) {
      out += c;
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) inStr = false;
      i++; continue;
    }
    if (c === '"' || c === "'") { inStr = true; q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}
// Bring any stored comment up to the v2 shape ({ status, messages[] }).
function normalizeComment(c) {
  if (!c || typeof c !== 'object') return null;
  const messages = Array.isArray(c.messages) && c.messages.length
    ? c.messages.map((m) => ({ author: m.author === 'agent' ? 'agent' : 'user', body: String(m.body || ''), at: m.at || c.createdAt || '' }))
    : [{ author: 'user', body: String(c.body || ''), at: c.createdAt || '' }]; // migrate v1 `body`
  const line = Number(c.line) || 0;
  // A range comment carries an `endLine` >= `line`; single-line comments omit it
  // (kept out of the serialized shape so existing files don't grow a field).
  const endLine = Number.isFinite(Number(c.endLine)) && Number(c.endLine) > line
    ? Math.floor(Number(c.endLine)) : undefined;
  // A thread made while reviewing a historical commit carries that commit's SHA in
  // `ref` (and is shown only in that commit's view); working-tree threads omit it.
  const ref = typeof c.ref === 'string' && c.ref ? c.ref : undefined;
  return {
    id: c.id, file: c.file, line, ...(endLine ? { endLine } : {}), ...(ref ? { ref } : {}), snippet: c.snippet || '',
    status: ['in-progress', 'resolved', 'closed'].includes(c.status) ? c.status : 'open',
    createdAt: c.createdAt || (messages[0] && messages[0].at) || '',
    sentAt: c.sentAt || null,
    messages,
  };
}
async function loadComments() {
  if (!state.storeKey) return;
  // A local edit (e.g. a just-sent thread flipped to "in-progress") may not have
  // hit disk yet; reloading now would read the stale file and clobber it. Skip —
  // the pending write is the source of truth and a later focus will re-sync.
  if (state.commentWritePending) return;
  const res = await runStore('read');
  let parsed = null;
  try { parsed = res.stdout ? JSON.parse(stripJsonc(res.stdout)) : null; } catch { parsed = null; }
  const arr = parsed && Array.isArray(parsed.comments) ? parsed.comments : [];
  state.comments = arr.map(normalizeComment).filter((c) => c && c.id && c.file);
  refreshComments();
}
const STORE_HEADER = [
  '// Muxy "review" extension — code review threads for this project.',
  '//',
  '// Lifecycle: a thread starts "open". When the user sends it to an agent the tab',
  '// flips it to "in-progress" (it has been handed off — you are working on it).',
  '// To resolve a thread: append an agent message to its "messages" array and set',
  '// "status" to "resolved" (or leave it "in-progress" and add an agent note explaining',
  '// why you could not). A "closed" thread is hidden from the tab entirely (dismissed',
  '// by the user); set "status" back to "open" to bring it back.',
  '// A finished thread looks exactly like this:',
  '//',
  '//   {',
  '//     "id": "ab12cd34", "file": "src/app.js", "line": 42,',
  '//     // "endLine": 45,  // OPTIONAL — present only on a multi-line range comment (endLine > line)',
  '//     // "ref": "<sha>", // OPTIONAL — present only if made while reviewing a past commit; "line" is',
  '//     //                 // that commit\'s line. Without it the thread is about the working tree.',
  '//     "snippet": "function foo() {", "status": "resolved",',
  '//     "createdAt": "2026-01-01T00:00:00.000Z", "sentAt": "2026-01-01T00:01:00.000Z",',
  '//     "messages": [',
  '//       { "author": "user",  "body": "abstract this",                 "at": "2026-01-01T00:00:00.000Z" },',
  '//       { "author": "agent", "body": "Done — extracted to renderFoo().", "at": "2026-01-01T00:05:00.000Z" }',
  '//     ]',
  '//   }',
  '//',
  '// Fields — status: "open" | "in-progress" | "resolved" | "closed"   ·   messages[].author: "user" | "agent"',
].join('\n');
// Persist the comment store. Debounced by default (coalesces rapid typing); pass
// `immediate` to flush synchronously (returns the write promise). Either way we
// raise `commentWritePending` for the whole queued+in-flight window so the
// focus-reload (`loadComments`) can't read a stale on-disk file and clobber a
// local edit that hasn't landed yet — the bug that made a just-sent thread snap
// back from "in-progress" to "open" when you returned to the tab.
function persistComments(immediate) {
  clearTimeout(state.commentSaveTimer);
  const seq = ++state.commentSeq;
  state.commentWritePending = true;
  const flush = () => {
    const body = JSON.stringify({
      version: 2, root: state.root || null,
      updatedAt: new Date().toISOString(), comments: state.comments,
    }, null, 2);
    return Promise.resolve(runStore('write', { content: `${STORE_HEADER}\n${body}\n` }))
      .finally(() => { if (seq === state.commentSeq) state.commentWritePending = false; });
  };
  if (immediate) return flush();
  state.commentSaveTimer = setTimeout(flush, 120);
}

/* ---- model ---- */
const nowISO = () => new Date().toISOString();
// "in-progress" is the stored value (a valid CSS class); show it spaced in the UI.
const statusLabel = (s) => (s === 'in-progress' ? 'in progress' : s);
// Closed threads are dismissed: hidden from the editor (wash + gutter), the drawer,
// the count, and the outgoing batch — but kept in the store so they can be reopened.
function isVisible(c) { return c.status !== 'closed'; }
// The last line a thread covers — `endLine` for a range, else its single `line`.
function endLineOf(c) { return c.endLine && c.endLine > c.line ? c.endLine : c.line; }
// "42" for a single line, "42–45" for a range.
function rangeLabel(line, endLine) { return endLine && endLine > line ? `${line}–${endLine}` : `${line}`; }
// The review ref a thread belongs to (a commit SHA, or null for the working tree).
// Comments are scoped to their ref, so a commit-view thread is painted/edited only
// while that commit is selected and never mis-anchors onto the working tree.
function refOf(c) { return c.ref || null; }
function sameRef(c) { return refOf(c) === (state.ref || null); }
function commentsForFile(file) {
  return state.comments.filter((c) => c.file === file && sameRef(c) && isVisible(c)).sort((a, b) => a.line - b.line);
}
// Locate a thread in the CURRENT ref. With an explicit `endLine > line`, match that
// exact range (the create/re-edit path for a drag). Otherwise treat `line` as a
// point and return the thread whose range *covers* it — so clicking any line number
// inside a range (or a single-line comment) opens the same thread instead of forking.
function findComment(file, line, endLine) {
  if (endLine != null && endLine > line) {
    return state.comments.find((c) => c.file === file && sameRef(c) && c.line === line && endLineOf(c) === endLine);
  }
  return state.comments.find((c) => c.file === file && sameRef(c) && line >= c.line && line <= endLineOf(c));
}
function findById(id) { return state.comments.find((c) => c.id === id); }
// Snippet captured at comment time. For a range, join the spanned lines (capped)
// so the spot is still locatable even if the snippet is shown on one row.
function lineSnippet(line, endLine) {
  try {
    if (view && line >= 1 && line <= view.state.doc.lines) {
      const last = Math.min(endLine && endLine > line ? endLine : line, view.state.doc.lines);
      const parts = [];
      for (let ln = line; ln <= last; ln++) parts.push(view.state.doc.line(ln).text.trim());
      return parts.join(' ⏎ ').slice(0, 200);
    }
  } catch { /* ignore */ }
  return '';
}
// The user's root message (messages[0]) — shown as the comment text in the drawer.
function rootBody(c) { return (c.messages && c.messages[0] && c.messages[0].body) || ''; }
// One thread per (file,line[,endLine]): re-commenting the same spot edits its
// root message. `endLine` (optional, > line) makes it a multi-line range comment.
async function upsertComment(file, line, body, endLine) {
  body = (body || '').trim();
  const range = endLine && endLine > line ? endLine : undefined;
  const existing = findComment(file, line, range);
  if (!body) { if (existing) removeComment(existing.id); return; }
  if (existing) {
    if (!existing.messages.length) existing.messages.push({ author: 'user', body, at: nowISO() });
    else existing.messages[0] = { ...existing.messages[0], author: 'user', body };
    if (!existing.snippet) existing.snippet = lineSnippet(existing.line, endLineOf(existing));
    existing.status = 'open';
    existing.sentAt = null; // edited → rejoins the outgoing batch
  } else {
    // Range id is keyed on the span so two threads starting on the same line
    // (one single, one range) never collide.
    // Key the id on the ref too (so a working-tree thread and a commit-view thread
    // on the same file:line never collide), and stamp the ref onto the thread.
    const ref = state.ref || undefined;
    state.comments.push({
      id: await hashHex(`${ref ? `${ref}:` : ''}${file}:${line}${range ? `-${range}` : ''}`, 16),
      file, line, ...(range ? { endLine: range } : {}), ...(ref ? { ref } : {}), snippet: lineSnippet(line, range),
      status: 'open', createdAt: nowISO(), sentAt: null,
      messages: [{ author: 'user', body, at: nowISO() }],
    });
  }
  persistComments();
  refreshComments();
}
function addReply(id, author, body) {
  const c = findById(id);
  body = (body || '').trim();
  if (!c || !body) return;
  c.messages.push({ author, body, at: nowISO() });
  if (author === 'user') { c.status = 'open'; c.sentAt = null; } // a user reply reopens
  persistComments();
  refreshComments();
}
function setStatus(id, status) {
  const c = findById(id);
  if (!c) return;
  c.status = ['in-progress', 'resolved', 'closed'].includes(status) ? status : 'open';
  persistComments();
  refreshComments();
}
function removeComment(id) {
  const i = state.comments.findIndex((c) => c.id === id);
  if (i < 0) return;
  state.comments.splice(i, 1);
  persistComments();
  refreshComments();
}
// Mark a batch as sent: stamp `sentAt` and flip open→in-progress (the agent flips
// it to "resolved" when done; resolved/closed re-sends keep their status). Called
// OPTIMISTICALLY — before the async delivery — so the drawer/gutter update live
// while the user is still on the Review tab (delivery often backgrounds the tab,
// so a refresh after delivery wouldn't be seen until they return). Returns a
// revert fn that restores the prior status/sentAt if delivery fails.
// NB: build the outgoing markdown BEFORE calling this — `buildMarkdown(null)`
// selects `status:'open'`, and this flips those very threads to in-progress.
function stampSent(subset) {
  const targets = subset || state.comments;
  const snapshot = targets.map((c) => ({ c, status: c.status, sentAt: c.sentAt }));
  const now = nowISO();
  for (const c of targets) {
    c.sentAt = now;
    if (c.status === 'open') c.status = 'in-progress';
  }
  persistComments(true); // flush now: get "in-progress" on disk before the agent (or a focus-reload) reads it
  refreshComments();
  return () => {
    for (const s of snapshot) { s.c.status = s.status; s.c.sentAt = s.sentAt; }
    persistComments(true);
    refreshComments();
  };
}
// Re-sync everything that reflects comment state.
function refreshComments() {
  refreshEditorComments(); renderDrawer(); updateCount();
  // Keep an open pinned popover in sync (e.g. after creating, replying,
  // resolving, or a focus-reload that pulled in the agent's response).
  if (popPinned && popFile) renderPinned();
}

/* ---- CodeMirror: line highlight + 💬 gutter (all input is in the popover) ---- */
const setCommentsEffect = StateEffect.define();   // comment[] for the open file

const commentData = StateField.define({
  create: () => ({ comments: [] }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setCommentsEffect)) return { comments: e.value };
    return value;
  },
});

// The line the mouse is currently over (0 = none). Drives a dimmed 💬 "add a
// comment here" hint in the comment gutter so the feature is discoverable. Fed
// by mousemove/leave listeners on the editor (see ensureEditor).
const setHoverLineEffect = StateEffect.define();
const hoverLineField = StateField.define({
  create: () => 0,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHoverLineEffect)) return e.value;
    return value;
  },
});

// While the user click-drags down the line-number gutter, paint a live preview
// wash over the lines the pending range covers. The effect carries `{a,b}` (the
// drag anchor and current line, either order) or `null` to clear; the field holds
// the derived `DecorationSet` directly (same pattern as `commentDeco`). Purely
// decorative — fed by the gutter mousedown/move handlers, committed on mouseup.
const setDragRangeEffect = StateEffect.define();
const dragRangeLineDeco = Decoration.line({ class: 'cm-drag-range-line' });
function buildDragRangeDeco(estate, range) {
  if (!range) return Decoration.none;
  const a = Math.max(1, Math.min(range.a, range.b));
  const b = Math.min(estate.doc.lines, Math.max(range.a, range.b));
  const ranges = [];
  for (let ln = a; ln <= b; ln++) ranges.push(dragRangeLineDeco.range(estate.doc.line(ln).from));
  return Decoration.set(ranges, true);
}
const dragRangeField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setDragRangeEffect)) return buildDragRangeDeco(tr.state, e.value);
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// A small button that survives being clicked inside the read-only editor
// (mousedown preventDefault keeps the textarea focused).
function mkMini(label, onClick, variant) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mini' + (variant ? ' ' + variant : '');
  b.textContent = label;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return b;
}

// A commented line gets a soft highlight (yellow = open, dimmed = resolved); the
// full thread shows in a hover tooltip (an overlay — it never reflows the doc).
const commentLineDeco = Decoration.line({ class: 'cm-commented-line' });
const resolvedLineDeco = Decoration.line({ class: 'cm-commented-line cm-resolved-line' });
const inProgressLineDeco = Decoration.line({ class: 'cm-commented-line cm-inprogress-line' });
const lineDecoFor = (status) =>
  status === 'resolved' ? resolvedLineDeco : status === 'in-progress' ? inProgressLineDeco : commentLineDeco;

// While the create-popover is pinned on a line/range that has no thread yet,
// paint the same yellow "open" wash over those lines so it's clear what you're
// about to comment on. The effect carries `{a,b}` (start/end, either order) or
// `null` to clear; cleared when the popover closes. Once the comment is saved
// it's an `open` thread and `commentDeco` owns the wash from then on.
const setPendingEffect = StateEffect.define();
function buildPendingDeco(estate, range) {
  if (!range) return Decoration.none;
  const a = Math.max(1, Math.min(range.a, range.b));
  const b = Math.min(estate.doc.lines, Math.max(range.a, range.b));
  const ranges = [];
  for (let ln = a; ln <= b; ln++) ranges.push(commentLineDeco.range(estate.doc.line(ln).from));
  return Decoration.set(ranges, true);
}
const pendingField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setPendingEffect)) return buildPendingDeco(tr.state, e.value);
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
function setPendingWash(range) { if (view) view.dispatch({ effects: setPendingEffect.of(range) }); }
/* ---- the thread popover: hover = peek (read-only), click = pin + reply ----
 * One shared floating element. Transient on hover (pointer-events off so it
 * can't steal the hover); on click it pins open, becomes interactive, and grows
 * a reply box + resolve/send actions. It is plain DOM over the editor (not a CM
 * widget), so it never reflows the document. */
let pop = null, popPinned = false, popId = null, popAnchor = null;
// Splice text in at the caret (replacing any selection) and keep the caret after it.
function insertAtCursor(ta, text) {
  const start = ta.selectionStart, end = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
}
function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'comment-pop';
  pop.hidden = true;
  document.body.appendChild(pop);
  return pop;
}
function positionPop(rect) {
  if (!rect) return;
  const el = ensurePop();
  const x = Math.min(rect.right + 8, window.innerWidth - el.offsetWidth - 8);
  // Prefer hanging BELOW the line/range so the commented line stays visible; if it
  // would overflow the bottom, flip to above the line; then clamp into the viewport.
  const gap = 4, h = el.offsetHeight, maxY = window.innerHeight - h - 8;
  const below = (rect.bottom != null ? rect.bottom : rect.top) + gap;
  let y = below;
  if (y > maxY) y = rect.top - h - gap; // no room below → place above the line
  y = Math.min(Math.max(8, y), Math.max(8, maxY));
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${y}px`;
}
function renderThread(into, c) {
  for (const m of c.messages) {
    const msg = document.createElement('div');
    msg.className = 'pop-msg ' + (m.author === 'agent' ? 'agent' : 'user');
    const who = document.createElement('span');
    who.className = 'pop-who';
    who.textContent = m.author === 'agent' ? 'agent' : 'you';
    const body = document.createElement('div');
    body.className = 'pop-text';
    body.textContent = m.body;
    msg.append(who, body);
    into.append(msg);
  }
}
// Transient hover preview (read-only). Suppressed while a popover is pinned.
function showPopPreview(c, rect) {
  if (popPinned || !c) return;
  const el = ensurePop();
  el.className = 'comment-pop preview ' + c.status;
  el.textContent = '';
  const thread = document.createElement('div');
  thread.className = 'pop-thread';
  renderThread(thread, c);
  el.append(thread);
  el.hidden = false;
  positionPop(rect);
}
function hidePopPreview() { if (!popPinned && pop) pop.hidden = true; }
// Pin the popover at a line. Keyed by (file,line) so it survives the
// create→thread transition: if the line has no comment it shows a "new comment"
// input; once created (or for an existing thread) it shows the thread + reply +
// resolve + send. All comment input happens here — there is no inline composer.
let popFile = null, popLine = 0, popEndLine = 0;
function pinPopAt(file, line, rect, endLine) {
  popPinned = true; popFile = file; popLine = line;
  popEndLine = endLine && endLine > line ? endLine : 0;
  popAnchor = rect;
  renderPinned();
  document.addEventListener('mousedown', onPopOutside, true);
}
function renderPinned() {
  const el = ensurePop();
  const c = findComment(popFile, popLine, popEndLine || undefined);
  popId = c ? c.id : null;
  // Display/submit against the resolved span: an existing thread's own range
  // (so clicking a line inside it shows the whole span), else the dragged range.
  const startL = c ? c.line : popLine;
  const endL = c ? endLineOf(c) : (popEndLine > popLine ? popEndLine : popLine);
  // Highlight the to-be-commented line/range while creating; once a thread exists
  // commentDeco paints the wash, so the pending one stands down.
  setPendingWash(c ? null : { a: startL, b: endL });
  const label = rangeLabel(startL, endL);
  const resolved = !!c && c.status === 'resolved';
  const closed = !!c && c.status === 'closed';
  el.className = 'comment-pop pinned' + (c ? ' ' + c.status : '');
  el.hidden = false;
  el.textContent = '';

  const head = document.createElement('div');
  head.className = 'pop-head';
  const where = document.createElement('span');
  where.className = 'pop-where';
  where.textContent = `${(popFile || '').split('/').pop()}:${label}`;
  head.append(where);
  if (c) {
    const status = document.createElement('span');
    status.className = `pop-status ${c.status}`;
    status.textContent = statusLabel(c.status);
    head.append(status);
  }
  const spacer = document.createElement('span');
  spacer.className = 'pop-spacer';
  head.append(spacer, mkMini('✕', closePop));
  el.append(head);

  if (c) {
    const thread = document.createElement('div');
    thread.className = 'pop-thread';
    renderThread(thread, c);
    el.append(thread);
  }

  const ta = document.createElement('textarea');
  ta.className = 'pop-reply';
  ta.rows = 2;
  ta.placeholder = c
    ? 'Reply…  (↵ to send, ⇧↵ for newline)'
    : `Comment on ${endL > startL ? `lines ${label}` : `line ${label}`}…  (↵ to send, ⇧↵ for newline)`;
  const submit = () => {
    const val = ta.value.trim();
    if (!val) return;
    if (c) addReply(c.id, 'user', val);
    else upsertComment(popFile, startL, val, endL); // create → re-render flips to thread mode
  };
  ta.addEventListener('keydown', (e) => {
    // Plain Return sends; Shift/Option(Alt)+Return inserts a newline. Shift+Enter
    // newlines natively, but Option+Enter does not — insert it ourselves.
    if (e.key === 'Enter') {
      if (!e.shiftKey && !e.altKey) { e.preventDefault(); submit(); }
      else if (e.altKey) { e.preventDefault(); insertAtCursor(ta, '\n'); }
    } else if (e.key === 'Escape') { e.preventDefault(); closePop(); }
    e.stopPropagation();
  });
  el.append(ta);

  const bar = document.createElement('div');
  bar.className = 'pop-bar';
  bar.append(mkMini(c ? 'Reply' : 'Add comment', submit, 'primary'));
  if (c && closed) {
    // A closed thread is only reachable via the line-number gutter (no marker shows);
    // the one action is to bring it back.
    bar.append(mkMini('Reopen', () => setStatus(c.id, 'open')));
  } else if (c) {
    bar.append(mkMini(resolved ? 'Reopen' : 'Resolve', () => setStatus(c.id, resolved ? 'open' : 'resolved')));
    // Close dismisses the thread from the tab entirely (kept in the store, reopenable).
    bar.append(mkMini('Close', () => { setStatus(c.id, 'closed'); closePop(); }));
  }
  el.append(bar);

  positionPop(popAnchor);
  setTimeout(() => ta.focus(), 0);
}
function closePop() {
  popPinned = false; popId = null; popFile = null; popLine = 0; popEndLine = 0; popAnchor = null;
  setPendingWash(null); // drop the to-be-commented highlight (a saved comment keeps its own wash)
  if (pop) pop.hidden = true;
  document.removeEventListener('mousedown', onPopOutside, true);
}
function onPopOutside(e) { if (pop && !pop.contains(e.target)) closePop(); }
function hidePop() { hidePopPreview(); closePop(); }
// A drawer-jump (and an edge-of-viewport line click) scrolls the editor programmatically
// before pinning the thread popover. While that programmatic motion is in flight we must
// stop the editor's own scroll listener from calling `hidePop` (it would dismiss the popover
// we're about to open). `suppressScrollClose` is held up for the duration of `onLineActivate`'s
// scroll-and-pin and then released; genuine user scrolls afterward still close the popover.
let suppressScrollClose = false;
function onEditorScroll() {
  scheduleSessionSave(); // remember the scroll position for the open file
  if (suppressScrollClose) return; // our own programmatic scroll — don't dismiss
  hidePop();
}
// Click a line (number gutter or 💬) — or jump from the drawer: scroll the line into view,
// then pin its thread popover (or an empty input to create). Positioning is the tricky part:
// the popover anchors to the line's viewport coords, but a single read right after dispatch is
// stale — CM applies `scrollIntoView` over its next measure cycle(s), and a cross-file drawer
// jump first resets `scrollTop` to 0 in `openFile` (a separate scroll). So instead of reading
// once, we poll each animation frame until the line's coords *stop moving* (stable across two
// frames), then pin against that final position. This is robust to multi-frame scrolls, the
// scrollTop reset, and a freshly-loaded doc whose line heights aren't measured yet. `center`
// (drawer jumps) parks the line mid-viewport; direct clicks use `nearest` so a visible line
// never moves (it stabilizes on frame two and pins immediately).
function onLineActivate(v, lineNo, opts) {
  const lines = v.state.doc.lines;
  const startLineNo = Math.min(Math.max(1, lineNo), lines);
  const pos = v.state.doc.line(startLineNo).from;
  // Bottom anchor = bottom of the LAST line of the span (or the single line), so
  // the popover hangs below the whole commented range and leaves it visible.
  const endLineNo = opts && opts.endLine ? Math.min(Math.max(startLineNo, opts.endLine), lines) : startLineNo;
  const endPos = v.state.doc.line(endLineNo).to;
  suppressScrollClose = true;
  v.dispatch({ effects: EditorView.scrollIntoView(pos, { y: opts && opts.center ? 'center' : 'nearest' }) });
  let prevTop = NaN, frames = 0;
  const done = (coords) => {
    // Use the start line's left for x and the end line's bottom for the vertical
    // anchor; fall back to the start line's own bottom if the end line isn't laid out.
    const endCoords = v.coordsAtPos(endPos);
    const rect = coords
      ? { right: coords.left, top: coords.top, bottom: (endCoords || coords).bottom }
      : { right: 48, top: 80, bottom: 80 };
    pinPopAt(state.current, lineNo, rect, opts && opts.endLine);
    // Release a touch later so the scroll's *trailing* async scroll event (which can fire just
    // after the coords settle) is still swallowed rather than closing the freshly-pinned popover.
    setTimeout(() => { suppressScrollClose = false; }, 120);
  };
  const tick = () => {
    const coords = v.coordsAtPos(pos);
    const top = coords ? Math.round(coords.top) : NaN;
    if (!Number.isNaN(top) && top === prevTop) return done(coords); // stable → final position
    prevTop = top;
    if (++frames < 15) requestAnimationFrame(tick);
    else done(coords); // give up after ~15 frames; pin wherever it landed
  };
  requestAnimationFrame(tick);
}

function buildCommentDeco(estate) {
  const data = estate.field(commentData);
  const docLines = estate.doc.lines;
  const ranges = [];
  for (const c of data.comments) {
    if (c.line < 1 || c.line > docLines) continue;
    const deco = lineDecoFor(c.status);
    const last = Math.min(endLineOf(c), docLines);
    for (let ln = c.line; ln <= last; ln++) ranges.push(deco.range(estate.doc.line(ln).from));
  }
  return Decoration.set(ranges, true);
}

const commentDeco = StateField.define({
  create: buildCommentDeco,
  update(deco, tr) {
    let rebuild = tr.docChanged;
    for (const e of tr.effects) if (e.is(setCommentsEffect)) rebuild = true;
    return rebuild ? buildCommentDeco(tr.state) : deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

class CommentGutterMarker extends GutterMarker {
  constructor(id, status) { super(); this.id = id; this.status = status; }
  eq(o) { return o.id === this.id && o.status === this.status; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-comment-dot ' + this.status;
    // Always 💬 — the ⟳/✓ glyphs were too thin to read at gutter size. Status is
    // conveyed by the line wash + the status CSS class on this marker instead.
    s.textContent = '💬';
    const id = this.id;
    // Hover peeks the thread (read-only); the click is handled by the gutter's
    // domEventHandlers below so a single path drives pinning.
    s.addEventListener('mouseenter', () => showPopPreview(findById(id), s.getBoundingClientRect()));
    s.addEventListener('mouseleave', hidePopPreview);
    return s;
  }
}
// A dimmed 💬 shown on the hovered line that has no thread yet — the discoverable
// "click to add a comment" affordance. Clicking is handled by the gutter's shared
// click handler (same path as an existing marker), so this is display-only.
class CommentHintMarker extends GutterMarker {
  eq() { return true; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-comment-dot hint';
    s.textContent = '💬';
    return s;
  }
}
const commentHintMarker = new CommentHintMarker();
const commentGutter = gutter({
  class: 'cm-comment-gutter',
  markers(v) {
    const data = v.state.field(commentData);
    const docLines = v.state.doc.lines;
    const commented = new Set();
    const ms = [];
    for (const c of data.comments) {
      if (c.line < 1 || c.line > docLines) continue;
      // The 💬 marker sits on the start line; the whole spanned range counts as
      // "commented" so the hover-add hint never appears inside an existing range.
      const last = Math.min(endLineOf(c), docLines);
      for (let ln = c.line; ln <= last; ln++) commented.add(ln);
      ms.push(new CommentGutterMarker(c.id, c.status).range(v.state.doc.line(c.line).from));
    }
    // Hover hint: a dimmed 💬 on the hovered line, unless it already has a thread.
    const hover = v.state.field(hoverLineField);
    if (hover >= 1 && hover <= docLines && !commented.has(hover)) {
      ms.push(commentHintMarker.range(v.state.doc.line(hover).from));
    }
    return RangeSet.of(ms, true);
  },
  // mousedown (not click) so a drag that STARTS on the 💬 marker selects a span
  // and opens a multi-line range thread — same gesture as the line-number gutter.
  // A plain click (down→up, no movement) still just opens/creates the one thread.
  domEventHandlers: {
    mousedown(v, block, e) { return gutterDragMousedown(v, block, e); },
  },
});

function commentExtensions() { return [commentData, hoverLineField, dragRangeField, pendingField, commentDeco, commentGutter]; }
// Line-number gutter interaction: a plain click leaves/opens a one-line thread;
// click-and-drag down (or up) the numbers selects a span and opens a multi-line
// range comment. We drive everything from mousedown (then document-level
// move/up) rather than CM's `click` so the drag never starts a text selection
// and a single down→up with no movement still behaves exactly like a click.
let lineDragAnchor = 0; // start line of an in-flight gutter drag (0 = idle)
// Shared mousedown→drag→up handler for any gutter that should support
// "click a line = single-line thread, drag a span = range thread" (the
// line-number gutter AND the 💬 comment gutter). A down→up with no movement
// is a plain click (single-line activate); any movement makes a range. We
// drive everything from mousedown + document-level move/up so the drag never
// starts a text selection and the two gutters behave identically.
function gutterDragMousedown(v, line, e) {
  if (e.button !== 0) return false; // left-button only; let context menus through
  e.preventDefault(); // no text selection / native gutter behavior while dragging
  lineDragAnchor = v.state.doc.lineAt(line.from).number;
  let curY = e.clientY, scrollRAF = 0;
  const paint = (ln) => v.dispatch({ effects: setDragRangeEffect.of({ a: lineDragAnchor, b: ln }) });
  paint(lineDragAnchor);
  const loop = () => {
    const dy = edgeAutoScroll(v, curY);
    if (dy) { v.scrollDOM.scrollTop += dy; paint(lineFromEvent(v, { clientX: 0, clientY: curY })); }
    scrollRAF = requestAnimationFrame(loop);
  };
  scrollRAF = requestAnimationFrame(loop);
  const move = (ev) => { curY = ev.clientY; paint(lineFromEvent(v, ev)); };
  const up = (ev) => {
    cancelAnimationFrame(scrollRAF);
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('mouseup', up, true);
    v.dispatch({ effects: setDragRangeEffect.of(null) });
    const start = lineDragAnchor; lineDragAnchor = 0;
    const end = lineFromEvent(v, ev);
    const a = Math.min(start, end), b = Math.max(start, end);
    if (a === b) onLineActivate(v, a);                  // no drag → single-line, as before
    else onLineActivate(v, a, { endLine: b });          // a span → range comment
  };
  document.addEventListener('mousemove', move, true);
  document.addEventListener('mouseup', up, true);
  return true;
}
function lineFromEvent(v, ev) {
  // `precise:false` clamps to the nearest line even when the pointer is in the
  // gutter or past the document edges (so dragging above/below still works).
  const pos = v.posAtCoords({ x: ev.clientX, y: ev.clientY }, false);
  return v.state.doc.lineAt(Math.max(0, Math.min(pos == null ? 0 : pos, v.state.doc.length))).number;
}
// Auto-scroll the editor while a drag is parked near the top/bottom edge, so a
// range can extend past the visible viewport without releasing the mouse.
function edgeAutoScroll(v, clientY) {
  const sd = v.scrollDOM, r = sd.getBoundingClientRect(), zone = 24;
  if (clientY < r.top + zone) return -Math.min(16, (r.top + zone - clientY));
  if (clientY > r.bottom - zone) return Math.min(16, (clientY - (r.bottom - zone)));
  return 0;
}
function lineNumberDragHandlers() {
  return { mousedown: gutterDragMousedown };
}

/* ---- CodeMirror: git diff line backgrounds (added green / removed red) ----
 * Decorative only, like the comment layer. A `setDiffEffect` carries the parsed
 * diff for the open file; a `Decoration.line` paints `+` lines green. Removed
 * lines have no home in the working-tree doc, so a removed run is COLLAPSED by
 * default to NOTHING in the document body — only a ▸ wedge in the diff gutter on
 * the line it preceded marks it, so the file reads top-to-bottom undisturbed.
 * Clicking the gutter dispatches `toggleDiffEffect`, which reveals the removed
 * text as a red block widget and flips the wedge to ▾ (click again to re-collapse).
 * Expansion lives in the field's `expanded` Set (anchor line numbers), reset on
 * every new diff. Unchanged files dispatch an empty diff → no decorations. */
const setDiffEffect = StateEffect.define();    // { added:Set, deletions:Map } for the open file
const toggleDiffEffect = StateEffect.define(); // anchor line number to expand/collapse
const emptyDiff = { added: new Set(), deletions: new Map(), expanded: new Set() };

const diffData = StateField.define({
  create: () => emptyDiff,
  update(value, tr) {
    let v = value;
    for (const e of tr.effects) {
      // A fresh diff resets expansion (every removed run starts collapsed).
      if (e.is(setDiffEffect)) v = { added: e.value.added, deletions: e.value.deletions, expanded: new Set() };
      else if (e.is(toggleDiffEffect)) {
        const expanded = new Set(v.expanded);
        expanded.has(e.value) ? expanded.delete(e.value) : expanded.add(e.value);
        v = { added: v.added, deletions: v.deletions, expanded };
      }
    }
    return v;
  },
});

const diffAddLineDeco = Decoration.line({ class: 'cm-diff-add-line' });

// EXPANDED removed run: a stack of red rows shown above its anchor line. Inert
// (no toggle here, so the text stays selectable); collapse via the gutter wedge.
class DeletedLinesWidget extends WidgetType {
  constructor(rows, anchor) { super(); this.rows = rows; this.anchor = anchor; }
  eq(o) { return o.anchor === this.anchor && o.rows.length === this.rows.length && o.rows.every((r, i) => r === this.rows[i]); }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-diff-deleted';
    for (const r of this.rows) {
      const line = document.createElement('div');
      line.className = 'cm-diff-deleted-line';
      line.textContent = r.length ? r : ' '; // keep empty removed lines visible
      wrap.append(line);
    }
    return wrap;
  }
  ignoreEvent() { return true; }
}

// Where a deletion's marker/widget renders: its anchor line, clamped to the last
// line for a deletion past doc end (which then renders AFTER it, side +1).
function deletionRenderLine(estate, anchor) {
  const docLines = estate.doc.lines;
  const past = anchor > docLines;
  return { line: estate.doc.line(past ? docLines : Math.max(1, anchor)), past };
}

function buildDiffDeco(estate) {
  const { added, deletions, expanded } = estate.field(diffData);
  const docLines = estate.doc.lines;
  const ranges = [];
  for (const ln of added) {
    if (ln < 1 || ln > docLines) continue;
    ranges.push(diffAddLineDeco.range(estate.doc.line(ln).from));
  }
  for (const [ln, rows] of deletions) {
    // Collapsed runs show only the gutter wedge — no body widget at all, so the
    // document is undisturbed. Only an expanded run renders its red rows.
    if (!expanded.has(ln)) continue;
    const { line, past } = deletionRenderLine(estate, ln);
    ranges.push(
      Decoration.widget({ widget: new DeletedLinesWidget(rows, ln), block: true, side: past ? 1 : -1 })
        .range(past ? line.to : line.from),
    );
  }
  return Decoration.set(ranges, true);
}

const diffDeco = StateField.define({
  create: buildDiffDeco,
  update(deco, tr) {
    let rebuild = tr.docChanged;
    for (const e of tr.effects) if (e.is(setDiffEffect) || e.is(toggleDiffEffect)) rebuild = true;
    return rebuild ? buildDiffDeco(tr.state) : deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// A gutter wedge on each deletion's render line: ▸ collapsed, ▾ expanded. Click
// to toggle (driven by the gutter's domEventHandlers → one path for the marker).
class DiffDeletionMarker extends GutterMarker {
  constructor(anchor, open, count) { super(); this.anchor = anchor; this.open = open; this.count = count; }
  eq(o) { return o.anchor === this.anchor && o.open === this.open && o.count === this.count; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-diff-wedge' + (this.open ? ' open' : '');
    s.textContent = this.open ? '▾' : '▸';
    s.title = `${this.count} removed line${this.count === 1 ? '' : 's'} — click to ${this.open ? 'collapse' : 'expand'}`;
    return s;
  }
}
// Map a clicked gutter line back to the deletion anchor rendered there.
function deletionAnchorAtLine(estate, lineNo) {
  for (const ln of estate.field(diffData).deletions.keys()) {
    if (deletionRenderLine(estate, ln).line.number === lineNo) return ln;
  }
  return null;
}
const diffGutter = gutter({
  class: 'cm-diff-gutter',
  markers(v) {
    const { deletions, expanded } = v.state.field(diffData);
    const ms = [];
    for (const [ln, rows] of deletions) {
      const { line } = deletionRenderLine(v.state, ln);
      ms.push(new DiffDeletionMarker(ln, expanded.has(ln), rows.length).range(line.from));
    }
    return RangeSet.of(ms, true);
  },
  domEventHandlers: {
    click(v, block) {
      const anchor = deletionAnchorAtLine(v.state, v.state.doc.lineAt(block.from).number);
      if (anchor == null) return false;
      v.dispatch({ effects: toggleDiffEffect.of(anchor) });
      return true;
    },
  },
});

function diffExtensions() { return [diffData, diffDeco, diffGutterCompartment.of([])]; }

/* ---- diff hunk navigation (the ↑/↓ toolbar) -------------------------------
 * A long file makes its scattered changes hard to find by eye, so the view
 * toolbar grows a pair of arrows that jump the viewport to the previous / next
 * change. A "hunk" is a contiguous run of change lines — added lines plus the
 * anchor line of each removed run (where the ▸ wedge sits). Adjacent change
 * lines collapse into one stop so a 30-line added block is a single jump, not
 * thirty. We store only the START line of each hunk; navigation is computed
 * fresh from the current scroll each press (so manual scrolling never desyncs)
 * and wraps around at the ends. */
function diffHunkLines(diff) {
  const lines = new Set();
  for (const ln of diff.added) lines.add(ln);
  for (const ln of diff.deletions.keys()) lines.add(Math.max(1, ln));
  const sorted = [...lines].sort((a, b) => a - b);
  const hunks = [];
  let prev = -Infinity;
  for (const ln of sorted) {
    if (ln - prev > 1) hunks.push(ln); // a clean line between runs splits the hunk
    prev = ln;
  }
  return hunks;
}

// Document-pixel top of a hunk's start line (clamped to the doc). Comparing
// pixel offsets — not line numbers via posAtCoords, which hit-tests the gutter
// at the corner and often returns null — is what makes prev/next reliable.
const NAV_MARGIN = 32; // also the scrollIntoView yMargin, so the just-jumped hunk reads as "at" the top
function hunkTop(ln) {
  const n = Math.min(Math.max(1, ln), view.state.doc.lines);
  return view.lineBlockAt(view.state.doc.line(n).from).top;
}

function gotoHunk(dir) {
  const hunks = state.diffHunks;
  if (!view || !hunks.length) return;
  // Reference = the doc-y pinned just under the toolbar. The +NAV_MARGIN (with a
  // 2px slop) excludes the hunk we last jumped to (parked NAV_MARGIN px down), so
  // repeated presses always advance instead of sticking on the current hunk.
  const ref = view.scrollDOM.scrollTop + NAV_MARGIN;
  let pick = null;
  if (dir > 0) { for (const ln of hunks) if (hunkTop(ln) > ref + 2) { pick = ln; break; } }
  else { for (let i = hunks.length - 1; i >= 0; i--) if (hunkTop(hunks[i]) < ref - 2) { pick = hunks[i]; break; } }
  if (pick == null) pick = dir > 0 ? hunks[0] : hunks[hunks.length - 1]; // wrap around the ends
  const lineNo = Math.min(Math.max(1, pick), view.state.doc.lines);
  view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(lineNo).from, { y: 'start', yMargin: NAV_MARGIN }) });
}

/* ---- editor-facing comment ops ---- */
function refreshEditorComments() {
  if (view) view.dispatch({ effects: setCommentsEffect.of(commentsForFile(state.current)) });
}

/* ---- comments drawer (bottom panel) ---- */
function updateCount() {
  const visible = state.comments.filter(isVisible);
  const badge = $('comments-count');
  if (badge) badge.textContent = visible.length ? String(visible.length) : '';
  const send = $('send-btn');
  if (send) send.disabled = visible.length === 0;
  const btn = $('comments-toggle');
  if (btn) btn.setAttribute('aria-expanded', String(!$('comments-drawer').hidden));
}
function toggleDrawer(force) {
  const d = $('comments-drawer');
  const open = typeof force === 'boolean' ? force : d.hidden;
  d.hidden = !open;
  state.panes.comments.open = open; // remember open/closed across visits
  savePane('comments');
  closeSendMenu();
  if (open) renderDrawer();
  updateCount();
}
function renderDrawer() {
  const list = $('cd-list');
  if (!list) return;
  list.textContent = '';
  const visible = state.comments.filter(isVisible);
  $('cd-empty').hidden = visible.length > 0;
  const byFile = new Map();
  for (const c of [...visible].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    if (!byFile.has(c.file)) byFile.set(c.file, []);
    byFile.get(c.file).push(c);
  }
  for (const [file, comments] of byFile) {
    const group = document.createElement('div');
    group.className = 'cd-group';
    const head = document.createElement('div');
    head.className = 'cd-file';
    head.textContent = file;
    group.append(head);
    for (const c of comments) {
      const resolved = c.status === 'resolved';
      const row = document.createElement('div');
      row.className = 'cd-item' + (resolved ? ' resolved' : '');

      // Overview only: line · status · snippet · (sent) · delete, then the
      // initial comment. Full thread + reply live in the line popover.
      const head = document.createElement('div');
      head.className = 'cd-head';
      const ln = document.createElement('button');
      ln.className = 'cd-line';
      ln.textContent = `L${rangeLabel(c.line, endLineOf(c))}`;
      ln.title = 'Jump to line & open thread';
      ln.addEventListener('click', () => jumpTo(c.file, c.line, c.ref));
      const status = document.createElement('span');
      status.className = `cd-status ${c.status}`;
      status.textContent = statusLabel(c.status);
      head.append(ln, status);
      // A thread anchored to a historical commit gets a small SHA badge; the
      // working-tree threads carry none (the common case). Jumping switches the ref.
      if (c.ref) {
        const refBadge = document.createElement('span');
        refBadge.className = 'cd-ref';
        refBadge.textContent = `@${c.ref.slice(0, 7)}`;
        const commit = state.commits.find((x) => x.sha === c.ref);
        refBadge.title = commit ? `commit ${commit.short} — ${commit.subject}` : `commit ${c.ref.slice(0, 7)}`;
        head.append(refBadge);
      }
      if (c.snippet) {
        const snip = document.createElement('code');
        snip.className = 'cd-snip';
        snip.textContent = c.snippet;
        head.append(snip);
      }
      const spacer = document.createElement('span');
      spacer.className = 'cd-spacer';
      head.append(spacer);
      if (c.sentAt) {
        const s = document.createElement('span');
        s.className = 'cd-sent';
        s.textContent = `sent ${fmtTime(c.sentAt)}`;
        head.append(s);
      }
      // Per-row send: a hover-revealed "Send ▾" that delivers just this thread to
      // a chosen agent/pane, reusing the same menu machinery as the drawer-wide send.
      const sendWrap = document.createElement('div');
      sendWrap.className = 'cd-send-wrap';
      const sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.className = 'cd-send';
      sendBtn.textContent = 'Send ▾';
      sendBtn.title = 'Send just this comment to an agent';
      const sendMenu = document.createElement('div');
      sendMenu.className = 'menu cd-menu';
      sendMenu.hidden = true;
      sendBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showSendMenu(sendMenu, sendWrap, {
          onNew: () => sendToNewAgent(c),
          onPane: (id, label) => sendToRunningPane(id, label, c),
          anchorEl: sendBtn,
        });
      });
      sendWrap.append(sendBtn, sendMenu);
      head.append(sendWrap);
      const del = document.createElement('button');
      del.className = 'cd-del';
      del.textContent = '✕';
      del.title = 'Close thread (hide; reopen by clicking its line number)';
      del.addEventListener('click', () => setStatus(c.id, 'closed'));
      head.append(del);
      row.append(head);

      // Just the initial comment (single author → no label). A reply count hints
      // there's more in the popover.
      const txt = document.createElement('div');
      txt.className = 'cd-text';
      txt.textContent = rootBody(c);
      row.append(txt);
      const replies = (c.messages || []).length - 1;
      if (replies > 0) {
        const more = document.createElement('div');
        more.className = 'cd-more';
        more.textContent = `${replies} ${replies === 1 ? 'reply' : 'replies'} · click L${rangeLabel(c.line, endLineOf(c))} to view`;
        row.append(more);
      }

      group.append(row);
    }
    list.append(group);
  }
}
async function jumpTo(file, line, ref) {
  // A thread lives in a specific ref; switch the picker to it first (rebuilds the
  // tree + reopens nothing) so the line numbers and content match the thread.
  if ((ref || null) !== (state.ref || null)) await selectRef(ref || null);
  if (file !== state.current) await openFile(file);
  if (view) onLineActivate(view, line, { center: true }); // scroll into view + pin the thread popover
}

/* ---- send menu + delivery ---- */
// One menu is open at a time — whether the drawer-wide "Send to agent ▾" or a
// per-row "Send ▾". `showSendMenu` populates any (menu, wrap) pair and routes the
// chosen target to the supplied onNew/onPane callbacks, so the global send and the
// per-row send share one code path; only the payload differs.
let openMenu = null; // { menuEl, wrapEl } — the one open dropdown (send OR sidebar-side)
function closeSendMenu() {
  if (openMenu) {
    openMenu.menuEl.hidden = true;
    openMenu.wrapEl.classList.remove('menu-open');
    openMenu = null;
  }
  $('ref-picker')?.setAttribute('aria-expanded', 'false'); // the ref picker tracks its open state
  document.removeEventListener('click', onDocClickForMenu, true);
  document.removeEventListener('keydown', onDocKeyForMenu, true);
}
function onDocClickForMenu(e) {
  if (openMenu && !openMenu.wrapEl.contains(e.target)) closeSendMenu();
}
function onDocKeyForMenu(e) {
  if (e.key === 'Escape' && openMenu) { e.preventDefault(); closeSendMenu(); }
}
// The toggle button's right-click menu: dock the file browser left or right. Reuses
// the shared `openMenu` machinery (one menu open at a time, outside-click/Esc to
// dismiss) and is fixed-positioned against the button via positionFixedMenu.
function openSidebarMenu() {
  const menuEl = $('sidebar-menu'), wrapEl = $('sidebar-toggle-wrap'), anchorEl = $('sidebar-toggle');
  if (openMenu && openMenu.menuEl === menuEl) { closeSendMenu(); return; } // toggle off
  closeSendMenu();
  menuEl.textContent = '';
  menuEl.append(menuLabel('file browser side'));
  const side = state.panes.sidebar.side;
  const tick = (s) => (side === s ? '✓ ' : '  '); // check vs. aligned blank
  menuEl.append(menuItem(`${tick('left')}Left`, '', () => { closeSendMenu(); setSidebarSide('left'); }));
  menuEl.append(menuItem(`${tick('right')}Right`, '', () => { closeSendMenu(); setSidebarSide('right'); }));
  menuEl.hidden = false;
  wrapEl.classList.add('menu-open');
  const place = () => positionFixedMenu(menuEl, anchorEl);
  openMenu = { menuEl, wrapEl, place };
  document.addEventListener('click', onDocClickForMenu, true);
  document.addEventListener('keydown', onDocKeyForMenu, true);
  place();
}
async function showSendMenu(menuEl, wrapEl, { onNew, onPane, anchorEl } = {}) {
  if (openMenu && openMenu.menuEl === menuEl) { closeSendMenu(); return; } // toggle off
  closeSendMenu();
  menuEl.textContent = '';
  menuEl.append(menuItem('✦  New agent', 'opens a terminal & runs claude', () => { closeSendMenu(); onNew(); }));
  const loading = menuLabel('scanning…');
  menuEl.append(loading);
  menuEl.hidden = false;
  wrapEl.classList.add('menu-open');
  // A per-row menu lives inside the scrolling #cd-body, which would clip an
  // absolutely-positioned dropdown — so anchored menus go `position: fixed`
  // (viewport-relative) and we re-place them as their height grows.
  const place = anchorEl ? () => positionFixedMenu(menuEl, anchorEl) : null;
  openMenu = { menuEl, wrapEl, place };
  document.addEventListener('click', onDocClickForMenu, true);
  document.addEventListener('keydown', onDocKeyForMenu, true);
  if (place) {
    place();
    $('cd-body')?.addEventListener('scroll', closeSendMenu, { once: true, passive: true });
  }
  const panes = await listWorkspacePanes();
  if (openMenu?.menuEl !== menuEl) return; // dismissed (or another opened) mid-scan
  loading.remove();
  if (panes.length) {
    menuEl.append(menuLabel('send to a pane'));
    // ★ = title names claude; • = some other pane. Either is sendable.
    for (const p of panes) {
      menuEl.append(menuItem(`${p.isClaude ? '★' : '•'}  ${p.label}`, p.cwd,
        () => { closeSendMenu(); onPane(p.id, p.label); }));
    }
  } else {
    menuEl.append(menuLabel('no panes in this workspace'));
  }
  place?.(); // height changed now that panes are listed
}
// Place a fixed menu against an anchor button — right-aligned, opening upward when
// there's room above (else downward), clamped to the viewport.
function positionFixedMenu(menuEl, anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  menuEl.style.right = 'auto';
  menuEl.style.bottom = 'auto';
  const mh = menuEl.offsetHeight, mw = menuEl.offsetWidth;
  const top = r.top > mh + 8 ? r.top - mh - 6 : r.bottom + 6;
  const left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
  menuEl.style.top = `${Math.max(8, top)}px`;
  menuEl.style.left = `${left}px`;
}
// Drawer-wide send: every open thread.
function toggleSendMenu() {
  if (!state.comments.some(isVisible)) { muxy.toast({ title: 'Review', body: 'No comments to send.' }); return; }
  showSendMenu($('send-menu'), $('send-wrap'), {
    onNew: () => sendToNewAgent(),
    onPane: (id, label) => sendToRunningPane(id, label),
  });
}
function menuItem(title, sub, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'menu-item';
  const t = document.createElement('div'); t.className = 'menu-title'; t.textContent = title;
  b.append(t);
  if (sub) { const s = document.createElement('div'); s.className = 'menu-sub'; s.textContent = sub; b.append(s); }
  b.addEventListener('click', onClick);
  return b;
}
function menuLabel(text) {
  const d = document.createElement('div');
  d.className = 'menu-label';
  d.textContent = text;
  return d;
}
// Case-insensitive field read — pane key casing isn't guaranteed
// (`panes.list()` returns e.g. WORKINGDIRECTORY / TITLE / ID).
function pickCI(obj, ...keys) {
  const map = {};
  for (const k of Object.keys(obj || {})) map[k.toLowerCase()] = obj[k];
  for (const k of keys) { const v = map[k.toLowerCase()]; if (v) return String(v); }
  return '';
}

// No detection heuristics — just the facts Muxy hands us. `panes.list()` returns
// every pane in the app, each with workingDirectory + title + id, so we filter to
// this workspace (panes whose cwd is the active project root or under it) and let
// the user pick. A pane whose title names "claude" gets a ★ hint (reliable, never
// misleading). We drop our own Review tab. Delivery is `panes.send`.
const normPath = (s) => String(s || '').replace(/\/+$/, '');
const isTrue = (v) => ['true', '1', 'yes'].includes(String(v).toLowerCase());
// Confirmed pane shape (from a live dump): { id, isFocused, title, workingDirectory }.
// `isFocused` is true on many panes (per-tab focus) so it is NOT a useful signal.
// We filter purely by workingDirectory matching the resolved project root.
async function listWorkspacePanes() {
  let panes = [];
  try { panes = (await muxy.panes.list()) || []; }
  catch (e) { console.warn('[review] panes.list() failed:', e); panes = []; }
  if (!Array.isArray(panes)) panes = [];
  const root = normPath(state.root || '');
  const inWorkspace = (cwd) => !!root && cwd && (cwd === root || cwd.startsWith(root + '/'));
  return panes.map((p) => {
    const title = pickCI(p, 'title', 'name');
    const cwd = normPath(pickCI(p, 'workingDirectory', 'workingDir', 'cwd', 'directory', 'path'));
    return {
      id: pickCI(p, 'id', 'paneId', 'uuid'),
      title,
      cwd,
      label: title || (cwd ? cwd.split('/').filter(Boolean).pop() : '') || 'pane',
      // Claude Code titles its terminal "✳ <task>" / "✳ Claude Code".
      isClaude: /claude/i.test(title) || title.trim().startsWith('✳'),
    };
  }).filter((r) => r.id && inWorkspace(r.cwd));
}
// Group comments by file into clean markdown — this is what the agent receives.
// With no argument, sends every OPEN thread (resolved are done, closed dismissed).
// With an explicit `subset` (the per-row send), sends exactly those threads the
// user picked, regardless of status — but never a dismissed/closed one.
function buildMarkdown(subset) {
  const open = subset
    ? subset.filter((c) => c.status !== 'closed')
    : state.comments.filter((c) => c.status === 'open');
  if (!open.length) return '';
  const byFile = new Map();
  for (const c of [...open].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    if (!byFile.has(c.file)) byFile.set(c.file, []);
    byFile.get(c.file).push(c);
  }
  const out = ['Please address the following review comments. Each item gives a file, a line (or line range), the current content of those lines, the comment thread, and an id.', ''];
  for (const [file, comments] of byFile) {
    out.push(`## ${file}`);
    for (const c of comments) {
      const where = endLineOf(c) > c.line ? `Lines ${c.line}–${endLineOf(c)}` : `Line ${c.line}`;
      // A thread anchored to a historical commit notes it — the line refers to that
      // commit's version of the file; the snippet is the durable anchor.
      const refNote = c.ref ? ` _(in commit ${c.ref.slice(0, 7)})_` : '';
      out.push(`- **${where}**${refNote}${c.snippet ? ` \`${c.snippet}\`` : ''} · id \`${c.id}\``);
      for (const m of c.messages) {
        const who = m.author === 'agent' ? 'agent' : 'user';
        const [first, ...rest] = m.body.split('\n');
        out.push(`  - ${who}: ${first}`);
        for (const bl of rest) out.push(`    ${bl}`);
      }
    }
    out.push('');
  }
  out.push('---');
  out.push(`These threads are stored as JSONC at \`~/.config/muxy/review/${state.storeKey}.json\` (the \`comments\` array, keyed by \`id\`).`);
  out.push('These threads are now marked `"in-progress"` (handed off to you). When you finish a comment, edit that file: append `{ "author": "agent", "body": "<short note to the user>", "at": "<ISO8601>" }` to that thread\'s `messages`, and set its `status` to `"resolved"`. If you can\'t address one, leave it `"in-progress"` and add an agent note explaining why.');
  return out.join('\n').trim();
}
async function sendToNewAgent(only) {
  const subset = only ? [only] : null;
  const md = buildMarkdown(subset);
  if (!md) return;
  const n = subset ? subset.length : state.comments.length;
  // Flip to in-progress NOW (before the terminal opens and backgrounds this tab)
  // so the user sees it live; `revert` rolls it back if the launch fails.
  const revert = stampSent(subset);
  // Stage the markdown as a file; the launch command reads it into claude's
  // FIRST message via command substitution, so the comment text never has to
  // be shell-escaped onto the command line.
  await runStore('prompt', { content: md });
  const promptPath = `"$HOME/.config/muxy/review/${state.storeKey}.prompt"`;
  let before = new Set();
  try { before = new Set(((await muxy.panes.list()) || []).map((p) => p.id)); } catch { /* ignore */ }
  try { await muxy.tabs.open({ kind: 'terminal' }); }
  catch (err) { revert(); return muxy.toast({ title: 'Review', body: `Could not open a terminal: ${err}` }); }
  let pane = null;
  for (let i = 0; i < 25 && !pane; i++) {
    await sleep(120);
    let now = [];
    try { now = (await muxy.panes.list()) || []; } catch { /* ignore */ }
    pane = now.find((p) => !before.has(p.id));
  }
  if (!pane) { revert(); return muxy.toast({ title: 'Review', body: 'Opened a terminal but could not find its pane.' }); }
  await sleep(300); // let the shell settle before typing
  const cd = state.root ? `cd ${shq(state.root)} && ` : '';
  // Send the command WITHOUT a trailing newline, then sendKeys Enter to submit
  // it — `panes.send` delivers its payload as a literal block, so a trailing
  // `\n` lands as an unsubmitted newline rather than running the command (same
  // reason `sendToRunningPane` splits the send from the Enter).
  try {
    await muxy.panes.send(pane.id, `${cd}claude "$(cat ${promptPath})"`);
    await sleep(80);
    await muxy.panes.sendKeys(pane.id, 'Enter');
  }
  catch (err) { revert(); return muxy.toast({ title: 'Review', body: `Could not launch claude: ${err}` }); }
  muxy.toast({ title: 'Review', body: `Sent ${n} comment(s) to a new agent.` });
}
async function sendToRunningPane(paneId, label, only) {
  const subset = only ? [only] : null;
  const md = buildMarkdown(subset);
  if (!md) return;
  const n = subset ? subset.length : state.comments.length;
  // Flip to in-progress NOW so it shows live even if delivery backgrounds this
  // tab; `revert` rolls it back if the send fails.
  const revert = stampSent(subset);
  try {
    // panes.send already delivers multi-line text as one block (newlines are
    // NOT submitted line-by-line), so send the markdown as-is, then Enter to send.
    await muxy.panes.send(paneId, md);
    await sleep(80);
    await muxy.panes.sendKeys(paneId, 'Enter');
  } catch (err) {
    revert();
    return muxy.toast({ title: 'Review', body: `Could not send to ${label}: ${err}` });
  }
  muxy.toast({ title: 'Review', body: `Sent ${n} comment(s) to ${label}.` });
}

/* ------------------------------------------------------------------ files */
async function resolveRoot() {
  // Confirmed shapes (live dump): worktrees/projects are
  // [{ id, path, name, isActive }]. Read the active entry's `path`
  // case-insensitively (only `isActive` — not `isFocused`, which is per-tab).
  const activePath = (list, ...pathKeys) => {
    const arr = Array.isArray(list) ? list : [];
    const active = arr.find((x) => isTrue(pickCI(x, 'isActive', 'active')));
    return active ? normPath(pickCI(active, ...pathKeys)) : '';
  };
  try {
    const r = activePath(await muxy.worktrees.list(), 'path', 'worktreePath', 'directory', 'workingDirectory');
    if (r) return r;
  } catch { /* ignore */ }
  try {
    const r = activePath(await muxy.projects.list(), 'path', 'projectPath', 'directory', 'workingDirectory');
    if (r) return r;
  } catch { /* ignore */ }
  return null; // fall back to exec's default cwd
}

async function loadFileList() {
  const { files, status, branch } = await runList(state.scope);
  if (!state.ref) state.branch = branch; // remember the branch for the "Working tree" label
  state.files = new Set(files);
  state.dirs = directoriesOf(files);
  // Working tree → `git status` porcelain; a selected commit → its `--name-status`.
  const gitStatus = state.ref ? parseNameStatus(status) : parseGitStatus(status);
  // Files with a diff to paint: anything reported as changed except outright
  // deletions (no content to open). Drives the per-file diff load.
  state.changedSet = new Set(gitStatus.filter((e) => e.status !== 'deleted').map((e) => e.path));

  // On the first build, pre-select the file from the saved session and make sure
  // its containing folders are open so the selection is actually visible (the
  // saved expansion set may not include them). resetPaths (scope switches) keeps
  // the user's live selection, so this only applies to the initial restore.
  const restore = !state.tree && state.restoreFile && state.files.has(state.restoreFile)
    ? state.restoreFile : null;
  const expandedPaths = restore
    ? [...new Set([...loadExpanded(), ...directoriesOf([restore])])]
    : loadExpanded();

  if (state.tree) {
    // resetPaths re-seeds expansion; restore this scope's remembered layout.
    state.tree.resetPaths(files, { initialExpandedPaths: expandedPaths });
    state.tree.setGitStatus(gitStatus);
  } else {
    state.tree = new FileTree({
      paths: files,
      gitStatus,
      search: true,
      // Start collapsed; reopen only the folders the user left open last time.
      initialExpansion: 'closed',
      initialExpandedPaths: expandedPaths,
      // Highlight the file restored from the last session (content is opened
      // explicitly in init; the openFile token guard absorbs any echo if this
      // initial selection also fires onSelectionChange).
      initialSelectedPaths: restore ? [restore] : undefined,
      flattenEmptyDirectories: true,
      // Make the search field span the sidebar and match app chrome. The
      // override CSS variables (see review.css) handle the rest of the theme.
      unsafeCSS: `
        [data-file-tree-search-container] {
          padding: 8px;
          margin-bottom: 4px;
          border-bottom: 1px solid var(--muxy-border);
        }
        [data-file-tree-search-input] {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--muxy-border);
          border-radius: 6px;
          background: var(--muxy-surface);
          color: var(--muxy-foreground);
        }
        [data-file-tree-search-input]::placeholder { color: var(--muxy-foreground-muted); }
      `,
      onSelectionChange: (selected) => {
        const path = selected && selected[0];
        if (path && state.files.has(path)) openFile(path);
      },
    });
    state.tree.render({ containerWrapper: $('tree-mount') });
    // Persist expansion whenever the store changes (debounced inside).
    state.tree.subscribe(scheduleSave);
  }

  $('tree-empty').hidden = files.length > 0;
}

// The ↻ button: re-read the file tree and the comments store AND re-read the
// currently open file's contents (it may have changed on disk since it was
// opened), preserving the scroll position so the user keeps their place.
async function reloadAll() {
  const file = state.current;
  const scroll = view ? view.scrollDOM.scrollTop : 0;
  await Promise.all([loadFileList(), loadComments(), loadCommits()]);
  updateRefButton(); // new commits may have landed; refresh the picker label
  // If the reviewed commit was rewritten away (rebase/amend), fall back to the
  // working tree rather than show an empty tree for a SHA that no longer exists.
  if (state.ref && !state.commits.some((c) => c.sha === state.ref)) {
    await selectRef(null);
    return;
  }
  // Re-open the same file (if one is open) so its body AND its diff reflect
  // what's now on disk — openFile re-reads the file and re-runs loadDiff against
  // the freshly rebuilt changedSet, so a committed file's now-stale diff clears.
  // NOT gated on the file still being in the current scope's tree: after a commit
  // it drops out of the "Changed" list, but it's still the file you're viewing,
  // so reload must refresh it rather than leave a stale buffer + diff on screen.
  // (openFile re-reads disk; a since-deleted file lands on its error notice.)
  // openFile resets scroll to the top, so restore the offset afterward.
  if (file) {
    await openFile(file);
    restoreScroll(scroll);
  }
}

/* ------------------------------------------------------------------ viewer */
// The editor stays in layout (visibility-toggled, never display:none) so
// CodeMirror keeps its measurements; the preview iframe and the placeholder/
// binary panels are absolute overlays that stack on top when shown.
function show(which) {
  $('placeholder').hidden = which !== 'placeholder';
  $('binary-notice').hidden = which !== 'binary';
  $('preview-mount').hidden = which !== 'preview';
  $('editor-mount').style.visibility = which === 'editor' ? 'visible' : 'hidden';
}

async function openFile(path) {
  // Bump a token so a slower read for a file the user already navigated away
  // from (or a duplicate open of the same path — e.g. the restore call echoing
  // the tree's initial selection) never commits over the current one.
  const token = ++state.openToken;
  state.current = path;
  state.currentText = null;
  state.currentKind = null;
  state.diffHunks = []; // cleared until loadDiff resolves (the real diff arrives async)

  if (BINARY_EXT.has(extOf(path))) return showBinary(path);

  const res = await runRead(path);
  if (token !== state.openToken) return; // superseded by a newer open
  if (res.exitCode !== 0) {
    return showBinary(path, res.stderr || 'Could not read file');
  }
  // Decide text vs binary on a sample so one stray control byte doesn't
  // disqualify a real text file (runProxy already stripped a trailing NUL).
  const text = res.stdout;
  if (looksBinary(text)) return showBinary(path);

  state.currentText = text;
  state.currentKind = previewKind(path);

  // Always load the source into CodeMirror — toggling back to Source is then
  // instant, and per-line comments map to the editor regardless of view mode.
  ensureEditor();
  setDoc(text, path);
  closePop(); // close any popover pinned on the previously open file
  // Seed this file's comments into the editor decorations/gutter, and clear any
  // diff left over from the previously open file (the real diff arrives async),
  // dropping the diff gutter column until/unless this file has removed runs.
  view.dispatch({ effects: [
    setCommentsEffect.of(commentsForFile(path)),
    setDiffEffect.of(emptyDiff),
    diffGutterCompartment.reconfigure([]),
  ] });
  loadDiff(path);
  updateToolbar();
  applyView(); // honors the remembered Source/Preview preference
  saveSession(); // remember this as the file to reopen next time (scroll follows on scroll)
}

// Fetch + paint the git diff for the open file. Skipped for files git doesn't
// report as changed (clean files have no diff). Guarded against races: a slow
// diff for a file the user already navigated away from is dropped.
async function loadDiff(path) {
  if (!state.changedSet.has(path)) return;
  const res = await runDiff(path);
  if (state.current !== path || !view) return; // user moved on; stale result
  const diff = parseDiff(res.stdout);
  // Add the diff gutter column only when there are removed runs to toggle.
  view.dispatch({ effects: [
    setDiffEffect.of(diff),
    diffGutterCompartment.reconfigure(diff.deletions.size ? diffGutter : []),
  ] });
  state.diffHunks = diffHunkLines(diff); // power the ↑/↓ nav (count + jump targets)
  updateToolbar();
}

/* ------------------------------------------------------- preview (md / html)
 * A rendered alternative to the CodeMirror source view, available for markdown
 * and HTML. The toggle is a per-file toolbar; the chosen mode is sticky. The
 * preview lives in a FULLY sandboxed iframe (sandbox="" → no scripts, opaque
 * origin), because content under review may be untrusted — markup, inline CSS,
 * tables and text render, but scripts never run and can't reach the parent.
 */
function updateToolbar() {
  const tb = $('view-toolbar');
  const seg = $('view-segmented');
  const nav = $('diff-nav');
  const n = state.diffHunks.length;
  // Arrows scroll the source editor, so they're only meaningful when source is
  // actually showing — hidden for a renderable file being previewed.
  const navShown = n > 0 && !(state.currentKind && state.view === 'preview');
  // The toolbar is shown when EITHER there's a Source/Preview choice to make
  // (renderable file) OR there are diff hunks to navigate.
  if (tb) tb.hidden = !state.currentKind && !navShown;
  if (seg) seg.hidden = !state.currentKind;
  if (nav) nav.hidden = !navShown;
  const count = $('diff-nav-count');
  if (count) count.textContent = n ? `${n} change${n === 1 ? '' : 's'}` : '';
  for (const btn of document.querySelectorAll('.vseg'))
    btn.setAttribute('aria-selected', String(btn.dataset.view === state.view));
  updateScriptsButton(); // its visibility/label tracks the open file (HTML only)
}

function setViewMode(mode) {
  state.view = mode === 'preview' ? 'preview' : 'source';
  saveViewMode(state.view);
  updateToolbar();
  applyView();
}

// Show the editor or the preview for the currently open file, per state.view.
function applyView() {
  if (state.currentKind && state.view === 'preview') {
    renderPreview(state.currentText, state.currentKind);
    show('preview');
  } else if (state.currentText != null) {
    show('editor');
  }
}

// Read the live Muxy theme colors so the markdown preview matches the app
// (the iframe is a separate document — CSS variables don't cascade into it,
// so we resolve them here and inject literal values).
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n, fb) => (cs.getPropertyValue(n) || '').trim() || fb;
  return {
    bg: g('--muxy-background', '#ffffff'),
    fg: g('--muxy-foreground', '#1d1d1f'),
    muted: g('--muxy-foreground-muted', '#6b6b6b'),
    surface: g('--muxy-surface', '#f4f4f5'),
    border: g('--muxy-border', '#dcdcde'),
    accent: g('--muxy-accent', '#2f6fed'),
  };
}

// A compact, GitHub-flavored stylesheet for the rendered markdown, themed with
// the resolved Muxy colors.
function markdownCss(c) {
  return `
    :root { color-scheme: ${muxy.theme?.colorScheme || 'light'}; }
    html, body { margin: 0; }
    body {
      background: ${c.bg}; color: ${c.fg};
      font: 14px/1.6 -apple-system, "SF Pro", system-ui, sans-serif;
      padding: 20px 28px; max-width: 900px;
      -webkit-text-size-adjust: 100%;
    }
    h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.5em; font-weight: 600; }
    h1 { font-size: 1.8em; border-bottom: 1px solid ${c.border}; padding-bottom: 0.3em; }
    h2 { font-size: 1.4em; border-bottom: 1px solid ${c.border}; padding-bottom: 0.3em; }
    h3 { font-size: 1.2em; } h4 { font-size: 1.05em; }
    p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
    a { color: ${c.accent}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 0.88em;
      background: ${c.surface}; border: 1px solid ${c.border};
      border-radius: 4px; padding: 0.12em 0.4em;
    }
    pre {
      background: ${c.surface}; border: 1px solid ${c.border};
      border-radius: 8px; padding: 12px 14px; overflow: auto;
    }
    pre code { background: none; border: 0; padding: 0; font-size: 0.86em; }
    blockquote {
      margin-left: 0; padding: 0.2em 1em; color: ${c.muted};
      border-left: 3px solid ${c.border};
    }
    hr { border: 0; border-top: 1px solid ${c.border}; margin: 1.8em 0; }
    table { border-collapse: collapse; display: block; overflow: auto; }
    th, td { border: 1px solid ${c.border}; padding: 6px 12px; }
    th { background: ${c.surface}; font-weight: 600; }
    img { max-width: 100%; }
    ul, ol { padding-left: 1.6em; }
    li { margin: 0.2em 0; }
    li input[type="checkbox"] { margin-right: 0.4em; }
    kbd {
      font-family: "SF Mono", Menlo, monospace; font-size: 0.85em;
      background: ${c.surface}; border: 1px solid ${c.border};
      border-bottom-width: 2px; border-radius: 4px; padding: 0.1em 0.4em;
    }
  `;
}

function renderPreview(text, kind) {
  const iframe = $('preview-mount');
  if (!iframe) return;
  if (kind === 'markdown') {
    const c = themeColors();
    let html = '';
    try { html = renderMarkdown(text); }
    catch (err) { html = `<pre>${escapeHtml(String(err))}</pre>`; }
    iframe.style.background = c.bg;
    iframe.setAttribute('sandbox', ''); // our own markup — never needs (or runs) scripts
    iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8">`
      + `<style>${markdownCss(c)}</style></head><body>${html}</body></html>`;
  } else {
    // Authored HTML is rendered as-is (on a white backdrop, as a browser would).
    // Scripts run only when the user has opted this file in (per-file toggle or an
    // active timed window) — and even then with `allow-scripts` ALONE, so the page
    // keeps an opaque origin and can't touch the parent tab. Set the attribute
    // BEFORE srcdoc so the (re)load picks it up.
    iframe.style.background = '#fff';
    iframe.setAttribute('sandbox', scriptsAllowed(state.current) ? 'allow-scripts' : '');
    iframe.srcdoc = text || '';
  }
}

/* ------------------------------------------------ scripts in HTML previews
 * HTML previews are scriptless by default (sandbox=""). Authored pages that
 * rely on inline JS (e.g. `onclick=`) need scripts to run, so the user can opt
 * in — per file (plain click), or for a timed window across files (⌥-click /
 * right-click → pick a duration, or "forever"). Scripts always run with
 * `allow-scripts` ALONE (opaque origin, no parent access). Per-file opt-ins and
 * a *timed* window are session-only; the chosen window length AND a "forever"
 * grant are remembered (forever persists across reloads until turned off).
 */
// scriptsUntil semantics: 0 = off, a future ms timestamp = timed window,
// Infinity = "forever" (the persisted always-on grant).
function scriptsForeverOn() { return state.scriptsUntil === Infinity; }
function scriptsWindowActive() {
  return state.scriptsUntil > 0 && Date.now() < state.scriptsUntil; // true for Infinity too
}
function scriptsAllowed(path) {
  if (scriptsWindowActive()) return true;            // forever or a live timed window: every HTML file
  return path != null && state.scriptFiles.has(path); // else this one file, if opted in
}
function endScriptWindow() {
  state.scriptsUntil = 0;
  saveScriptsForever(false); // turning off also clears any persisted "forever"
  if (state.scriptTimer) { clearInterval(state.scriptTimer); state.scriptTimer = 0; }
}
function startScriptWindow(minutes) {
  saveScriptWindow(minutes);
  saveScriptsForever(false); // a timed window supersedes (and clears) a persisted "forever"
  state.scriptsUntil = Date.now() + minutes * 60_000;
  if (state.scriptTimer) clearInterval(state.scriptTimer);
  // Tick to keep the countdown label fresh and to revoke scripts the moment the
  // window lapses (re-render the live preview without allow-scripts).
  state.scriptTimer = setInterval(onScriptTick, 15_000);
  refreshScripts();
}
// "Forever" — always run scripts, persisted across reloads (no countdown, so no
// tick). Restored on load in init() via loadScriptsForever().
function enableScriptsForever() {
  saveScriptsForever(true);
  state.scriptsUntil = Infinity;
  if (state.scriptTimer) { clearInterval(state.scriptTimer); state.scriptTimer = 0; }
  refreshScripts();
}
function onScriptTick() {
  if (!scriptsWindowActive()) { endScriptWindow(); refreshScripts(); return; }
  updateScriptsButton(); // just refresh the "· Nm" countdown
}
// The master on/off for the current file. If scripts are on (either reason),
// turn them fully off — clear this file's opt-in AND any active window (the
// window is global, so the toggle is a global kill-switch when one is running).
function toggleScripts() {
  const path = state.current;
  if (path == null) return;
  if (scriptsAllowed(path)) {
    state.scriptFiles.delete(path);
    if (scriptsWindowActive()) endScriptWindow();
  } else {
    state.scriptFiles.add(path);
  }
  refreshScripts();
}
// Re-paint the live HTML preview so a scripts on/off change takes effect, then
// reflect the new state on the toolbar button.
function refreshScripts() {
  if (state.currentKind === 'html' && state.view === 'preview') {
    renderPreview(state.currentText, state.currentKind);
  }
  updateScriptsButton();
}
function updateScriptsButton() {
  const wrap = $('view-scripts-wrap'), btn = $('view-scripts');
  if (!wrap || !btn) return;
  const isHtml = state.currentKind === 'html';
  wrap.hidden = !isHtml; // scripts only mean anything for an HTML preview
  if (!isHtml) return;
  const on = scriptsAllowed(state.current);
  btn.setAttribute('aria-pressed', String(on));
  if (scriptsForeverOn()) {
    btn.textContent = '⚡ Scripts on · always';
    btn.title = 'Scripts enabled for every HTML preview, permanently (persists across reloads). '
      + 'Click to turn off; ⌥-click to change.';
  } else if (scriptsWindowActive()) {
    const mins = Math.max(1, Math.ceil((state.scriptsUntil - Date.now()) / 60_000));
    btn.textContent = `⚡ Scripts on · ${mins}m`;
    btn.title = `Scripts enabled for every HTML preview for ${mins} more minute${mins === 1 ? '' : 's'}. `
      + `Click to turn off; ⌥-click to change the window.`;
  } else if (on) {
    btn.textContent = '⚡ Scripts on';
    btn.title = 'Scripts enabled for this file. Click to turn off; ⌥-click (or right-click) for a timed window across files.';
  } else {
    btn.textContent = '⚡ Enable scripts';
    btn.title = 'Run scripts in this HTML preview. Click to enable for this file; ⌥-click (or right-click) for a timed window across files.';
  }
}
function labelMinutes(m) {
  if (m >= 60 && m % 60 === 0) { const h = m / 60; return `${h} hour${h === 1 ? '' : 's'}`; }
  return `${m} minute${m === 1 ? '' : 's'}`;
}
// ⌥-click / right-click the button: choose a timed window (or turn off). Reuses
// the shared one-open-at-a-time `openMenu` machinery + positionFixedMenu.
function openScriptsMenu() {
  const menuEl = $('scripts-menu'), wrapEl = $('view-scripts-wrap'), anchorEl = $('view-scripts');
  if (openMenu && openMenu.menuEl === menuEl) { closeSendMenu(); return; } // toggle off
  closeSendMenu();
  buildScriptsMenu(menuEl);
  menuEl.hidden = false;
  wrapEl.classList.add('menu-open');
  const place = () => positionFixedMenu(menuEl, anchorEl);
  openMenu = { menuEl, wrapEl, place };
  document.addEventListener('click', onDocClickForMenu, true);
  document.addEventListener('keydown', onDocKeyForMenu, true);
  place();
}
function buildScriptsMenu(menuEl) {
  menuEl.textContent = '';
  menuEl.append(menuLabel('run scripts in HTML previews'));
  const presets = [10, 30, 60];
  const last = loadScriptWindow();
  if (!presets.includes(last)) presets.push(last); // surface the custom default too
  presets.sort((a, b) => a - b);
  for (const m of presets) {
    menuEl.append(menuItem(`for ${labelMinutes(m)}`, 'across every file until it expires',
      () => { closeSendMenu(); startScriptWindow(m); }));
  }
  menuEl.append(menuItem('custom…', 'choose a number of minutes',
    () => customScriptWindow(menuEl)));
  menuEl.append(menuItem(`${scriptsForeverOn() ? '✓ ' : ''}forever`, 'always on; persists across reloads',
    () => { closeSendMenu(); enableScriptsForever(); }));
  if (scriptsWindowActive() || state.scriptFiles.size) {
    menuEl.append(menuItem('turn off now', 'disable scripts everywhere',
      () => { closeSendMenu(); state.scriptFiles.clear(); endScriptWindow(); refreshScripts(); }));
  }
  openMenu?.place?.();
}
// Swap the menu body to an inline minutes input — NOT window.prompt(), which
// would block the whole webview (a modal dialog freezes the extension bridge).
function customScriptWindow(menuEl) {
  menuEl.textContent = '';
  menuEl.append(menuLabel('minutes to enable scripts'));
  const row = document.createElement('div');
  row.className = 'menu-custom';
  const input = document.createElement('input');
  input.type = 'number'; input.min = '1'; input.max = '720';
  input.className = 'menu-custom-input';
  input.value = String(loadScriptWindow());
  const go = document.createElement('button');
  go.type = 'button'; go.className = 'action'; go.textContent = 'Enable';
  const commit = () => {
    const n = Math.max(1, Math.min(720, parseInt(input.value, 10) || 0));
    if (!n) return;
    closeSendMenu();
    startScriptWindow(n);
  };
  go.addEventListener('click', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  row.append(input, go);
  menuEl.append(row);
  openMenu?.place?.(); // height changed
  input.focus(); input.select();
}

// True when a sample of the content reads as binary: an embedded NUL, or a
// high ratio of non-whitespace control characters.
function looksBinary(text) {
  const sample = text.slice(0, 4096);
  if (!sample) return false;
  let ctrl = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) ctrl++; // allow \t \n \v \f \r
  }
  return ctrl / sample.length > 0.2;
}

function showBinary(path, message) {
  state.currentText = null;
  state.currentKind = null;
  state.diffHunks = [];
  updateToolbar(); // hides the Source/Preview bar — nothing to render
  $('binary-text').textContent = message || "This file can't be displayed as text.";
  show('binary');
  saveSession(); // a binary file is still "the open file" — reopen it (placeholder) next time
}

function absPath(rel) {
  if (!state.root) return rel;
  return state.root.replace(/\/$/, '') + '/' + rel;
}

async function openInMuxy(path) {
  if (!path) return;
  try {
    await muxy.tabs.open({ kind: 'editor', filePath: absPath(path) });
  } catch (err) {
    muxy.toast({ title: 'Review', body: `Could not open editor: ${err}` });
  }
}

/* ------------------------------------------------------------------ wiring */
// Reflect the active scope on the #segmented buttons. Scoped to #segmented because
// `.seg` also matches the view-mode (vseg) tabs.
function reflectScope() {
  for (const btn of document.querySelectorAll('#segmented .seg')) {
    btn.setAttribute('aria-selected', String(btn.dataset.scope === state.scope));
  }
}
function selectScope(scope) {
  if (scope === state.scope) return;
  state.scope = scope;
  reflectScope();
  saveSession(); // scope is part of the restored session
  loadFileList();
}

/* ---- review ref (working tree | a historical git-log commit) -------------
 * A topbar picker chooses WHAT to review: the working tree (uncommitted changes
 * vs HEAD — the default, today's behavior) or one commit from `git log` (its diff
 * vs its first parent). Selecting a ref re-drives the whole pipeline — the file
 * list, per-file content (`git show <sha>:<file>`), and the inline diff paint —
 * through the same exec proxies, which all grew a REVIEW_REF env branch. */
async function loadCommits() {
  try { state.commits = await runLog(); } catch { state.commits = []; }
}
// The label/tooltip on the picker button reflects the current selection.
function updateRefButton() {
  const label = $('ref-label'), btn = $('ref-picker');
  if (!label || !btn) return;
  $('ref-picker-wrap')?.classList.toggle('reviewing', !!state.ref);
  if (!state.ref) {
    label.textContent = state.branch ? `Working tree · ${state.branch}` : 'Working tree';
    btn.title = 'Reviewing the working tree — uncommitted changes vs HEAD. Click to review a commit.';
  } else {
    const c = state.commits.find((x) => x.sha === state.ref);
    const short = c ? c.short : state.ref.slice(0, 7);
    label.textContent = c ? `${short} · ${c.subject}` : short;
    btn.title = c
      ? `Reviewing commit ${short} — ${c.subject} (${c.author}, ${c.date})`
      : `Reviewing commit ${short}`;
  }
}
// Switch the review ref. Picking a commit also flips an "All" scope to "Changed"
// (so the sidebar shows the commit's diff, per the design); selecting the working
// tree leaves the scope alone. Rebuilds the file list and reopens the current file
// under the new ref (its content + diff differ), or lands on the placeholder if it
// isn't present in this ref's tree.
async function selectRef(ref) {
  const next = ref || null;
  if (next === (state.ref || null)) return;
  state.ref = next;
  if (next && state.scope === 'all') { state.scope = 'changed'; reflectScope(); }
  updateRefButton();
  saveSession();
  await loadFileList();
  const cur = state.current;
  if (cur && state.files.has(cur)) {
    await openFile(cur); // re-read content + diff for the new ref
  } else if (cur) {
    state.current = null; state.currentText = null; state.currentKind = null; state.diffHunks = [];
    closePop();
    updateToolbar();
    show('placeholder');
    saveSession();
  }
  refreshComments(); // ref-scoped threads change which ones paint
}
// The searchable commit dropdown. Reuses the one-open-at-a-time / outside-click /
// Esc machinery (`openMenu`/closeSendMenu) and fixed positioning, but its body is a
// search input over a scrollable list rather than the flat send-menu items.
function openRefMenu() {
  const menuEl = $('ref-menu'), wrapEl = $('ref-picker-wrap'), anchorEl = $('ref-picker');
  if (openMenu && openMenu.menuEl === menuEl) { closeSendMenu(); return; } // toggle off
  closeSendMenu();
  menuEl.textContent = '';
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'ref-search';
  search.placeholder = 'Search commits…';
  const list = document.createElement('div');
  list.className = 'ref-list';
  menuEl.append(search, list);
  menuEl.hidden = false;
  wrapEl.classList.add('menu-open');
  anchorEl.setAttribute('aria-expanded', 'true');
  const place = () => positionFixedMenu(menuEl, anchorEl);
  search.addEventListener('input', () => { renderRefList(list, search.value); place(); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSendMenu(); }
    else if (e.key === 'Enter') { const first = list.querySelector('.ref-row'); if (first) { e.preventDefault(); first.click(); } }
    e.stopPropagation();
  });
  renderRefList(list, '');
  openMenu = { menuEl, wrapEl, place };
  document.addEventListener('click', onDocClickForMenu, true);
  document.addEventListener('keydown', onDocKeyForMenu, true);
  place();
  setTimeout(() => search.focus(), 0);
}
// One selectable row in the ref list. `mono` (a short SHA) is rendered in the code
// font ahead of the title; selecting it closes the menu and switches the ref.
function refRow(ref, mono, title, sub, selected) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ref-row' + (selected ? ' selected' : '');
  const tick = document.createElement('span');
  tick.className = 'ref-tick';
  tick.textContent = selected ? '✓' : '';
  const main = document.createElement('div');
  main.className = 'ref-main';
  const top = document.createElement('div');
  top.className = 'ref-top';
  if (mono) { const m = document.createElement('code'); m.className = 'ref-sha'; m.textContent = mono; top.append(m); }
  const t = document.createElement('span'); t.className = 'ref-title'; t.textContent = title; top.append(t);
  main.append(top);
  if (sub) { const s = document.createElement('div'); s.className = 'ref-sub'; s.textContent = sub; main.append(s); }
  b.append(tick, main);
  b.addEventListener('click', () => { closeSendMenu(); selectRef(ref); });
  return b;
}
function renderRefList(list, filter) {
  list.textContent = '';
  const f = (filter || '').trim().toLowerCase();
  const cur = state.ref || null;
  // The working-tree entry is always at the top (matches "working"/"head"/branch).
  const wtHay = `working tree head ${state.branch || ''}`.toLowerCase();
  if (!f || wtHay.includes(f)) {
    list.append(refRow(null, '', 'Working tree', state.branch ? `uncommitted changes · ${state.branch}` : 'uncommitted changes', cur === null));
  }
  let shown = 0;
  for (const c of state.commits) {
    if (f && !`${c.short} ${c.sha} ${c.subject} ${c.author}`.toLowerCase().includes(f)) continue;
    list.append(refRow(c.sha, c.short, c.subject, `${c.author} · ${c.date}`, cur === c.sha));
    shown++;
  }
  if (!shown && f) {
    const none = menuLabel('no commits match');
    list.append(none);
  }
}

/* ---- pane layout (sidebar + comments drawer) ----
 * Geometry constraints, shared by the live drag handlers AND the persisted-value
 * restore, so a stored size can never exceed what a drag would have allowed
 * (e.g. a width saved on a wide window is reined in on a narrow one). */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sidebarBounds = () => ({ min: 140, max: Math.round(window.innerWidth * 0.7) });
const drawerBounds = () => ({ min: 120, max: Math.round(window.innerHeight * 0.85) });

// Apply the remembered sidebar geometry: width (if any) and open/closed. There's
// no hide control wired to a button yet, but honoring `open` here means a future
// toggle is just setSidebarOpen() — see "pane layout persistence".
function applySidebarLayout() {
  const sidebar = $('sidebar'), divider = $('divider'), app = $('app');
  const { open, size, side } = state.panes.sidebar;
  if (size != null) {
    const { min, max } = sidebarBounds();
    sidebar.style.width = clamp(size, min, max) + 'px';
  }
  // Dock side: a class on #app reverses the split's flex row (content | divider |
  // sidebar) and flips the separating border/divider margins in CSS — and also
  // re-orders the topbar so the toggle follows the pane to the right edge. (It
  // lives on #app, not #split, because the topbar is a *sibling* of #split.)
  // Width is kept across a side swap — the clamp bounds are symmetric (≤70vw).
  if (app) app.classList.toggle('sidebar-right', side === 'right');
  sidebar.hidden = !open;
  if (divider) divider.hidden = !open; // no handle to drag when the sidebar's gone
}
function setSidebarSize(px) {
  const { min, max } = sidebarBounds();
  state.panes.sidebar.size = clamp(Math.round(px), min, max);
  savePane('sidebar');
}
// Show/hide the sidebar: flip open, re-apply, persist.
function setSidebarOpen(open) {
  state.panes.sidebar.open = !!open;
  applySidebarLayout();
  savePane('sidebar');
}
// Dock the sidebar to the left or right edge of the split. No-op if unchanged.
function setSidebarSide(side) {
  side = side === 'right' ? 'right' : 'left';
  if (state.panes.sidebar.side === side) return;
  state.panes.sidebar.side = side;
  applySidebarLayout();
  savePane('sidebar');
}
// Topbar toggle for the file-browser pane. `force` overrides the flip (used on
// load to apply the restored state). Refreshes the button's pressed state.
function toggleSidebar(force) {
  setSidebarOpen(typeof force === 'boolean' ? force : !state.panes.sidebar.open);
  updateSidebarToggle();
}
function updateSidebarToggle() {
  const b = $('sidebar-toggle');
  if (!b) return;
  const open = state.panes.sidebar.open;
  b.setAttribute('aria-pressed', String(open));
  b.title = open ? 'Hide file browser' : 'Show file browser';
}

// The drawer's open/closed state rides on toggleDrawer (it owns `hidden` and
// persists `open`); here we only restore the remembered height.
function applyDrawerLayout() {
  const drawer = $('comments-drawer');
  const { size } = state.panes.comments;
  if (drawer && size != null) {
    const { min, max } = drawerBounds();
    drawer.style.height = clamp(size, min, max) + 'px';
  }
}
function setDrawerSize(px) {
  const { min, max } = drawerBounds();
  state.panes.comments.size = clamp(Math.round(px), min, max);
  savePane('comments');
}

function wireDivider() {
  const divider = $('divider');
  const sidebar = $('sidebar');
  let startX = 0, startW = 0, dragging = false;
  // When docked right, the divider sits on the sidebar's LEFT edge, so dragging
  // left (decreasing clientX) widens it — invert the delta.
  const sideDir = () => (state.panes.sidebar.side === 'right' ? -1 : 1);
  const onMove = (e) => {
    if (!dragging) return;
    const { min, max } = sidebarBounds();
    sidebar.style.width = clamp(startW + sideDir() * (e.clientX - startX), min, max) + 'px';
  };
  const onUp = () => {
    dragging = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    setSidebarSize(sidebar.getBoundingClientRect().width); // persist the dragged width
  };
  divider.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
  divider.addEventListener('keydown', (e) => {
    const w = sidebar.getBoundingClientRect().width;
    // Spatially consistent with the drag: the arrow pointing toward the divider's
    // edge grows the pane (so ArrowLeft grows it when docked right).
    const grow = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!grow) return;
    setSidebarSize(w + grow * sideDir() * 16);
    applySidebarLayout(); // reflect the new (clamped, persisted) width
  });
  wireDrawerDivider();
}

// Same drag logic as the sidebar divider, but vertical: drag the drawer's top
// edge up/down. Dragging up grows the drawer, so height moves inversely to Y.
function wireDrawerDivider() {
  const cdDivider = $('cd-divider');
  const drawer = $('comments-drawer');
  if (!cdDivider || !drawer) return;
  let startY = 0, startH = 0, dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    const { min, max } = drawerBounds();
    drawer.style.height = clamp(startH - (e.clientY - startY), min, max) + 'px';
  };
  const onUp = () => {
    dragging = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    setDrawerSize(drawer.getBoundingClientRect().height); // persist the dragged height
  };
  cdDivider.addEventListener('mousedown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = drawer.getBoundingClientRect().height;
    document.body.style.cursor = 'row-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
  cdDivider.addEventListener('keydown', (e) => {
    const h = drawer.getBoundingClientRect().height;
    if (e.key === 'ArrowUp') setDrawerSize(h + 16);
    else if (e.key === 'ArrowDown') setDrawerSize(h - 16);
    else return;
    applyDrawerLayout(); // reflect the new (clamped, persisted) height
  });
}

function wireTheme() {
  // Live theme updates are best-effort. Not every Muxy build's frozen `window.muxy`
  // bridge exposes `onThemeChange` (the initial colors are already applied from
  // `muxy.theme?.colorScheme` at editor creation and in the injected `:root` style).
  // Calling a missing bridge method throws synchronously, and because init() is fired
  // un-awaited (see the bottom of this file) that throw would reject init's promise and
  // abort the entire tab before the file tree ever loads — so feature-detect first.
  if (typeof muxy?.onThemeChange !== 'function') return;
  muxy.onThemeChange((theme) => {
    if (!view) return;
    const scheme = theme.colorScheme || 'dark';
    view.dispatch({
      effects: [
        themeCompartment.reconfigure(editorTheme(scheme === 'dark')),
        highlightCompartment.reconfigure(highlightStyle(scheme)),
      ],
    });
    // Markdown preview bakes in literal theme colors, so re-render on change.
    if (state.currentKind === 'markdown' && state.view === 'preview') {
      renderPreview(state.currentText, state.currentKind);
    }
  });
}

// init() runs a chain of synchronous DOM/bridge wiring before its first await. A
// throw anywhere in that prologue (e.g. a bridge method this Muxy build doesn't
// expose) rejects the promise and leaves the tab half-wired and blank — which reads
// as a crash. Surface it instead: log the real message (the bridge logs an uncaught
// rejection's `.stack`, which in JSC omits the message line) and paint a visible
// error state so a failure is diagnosable rather than a silent blank pane.
function reportFatal(err) {
  const detail = (err && (err.stack || err.message)) || String(err);
  console.error(`[review] init failed: ${detail}`);
  const ph = $('placeholder');
  if (!ph) return;
  ph.hidden = false;
  ph.replaceChildren();
  const inner = document.createElement('div');
  inner.className = 'placeholder-inner';
  const icon = document.createElement('div');
  icon.className = 'placeholder-icon';
  icon.textContent = '⚠';
  const heading = document.createElement('p');
  heading.textContent = 'The review tab failed to start.';
  const pre = document.createElement('pre');
  pre.className = 'fatal-detail';
  pre.textContent = detail;
  inner.append(icon, heading, pre);
  ph.append(inner);
}

async function init() {
  $('seg-all').addEventListener('click', () => selectScope('all'));
  $('seg-changed').addEventListener('click', () => selectScope('changed'));
  $('view-source').addEventListener('click', () => setViewMode('source'));
  $('view-preview').addEventListener('click', () => setViewMode('preview'));
  // Plain click toggles scripts for the open HTML file; ⌥-click (or right-click)
  // opens the timed-window picker.
  $('view-scripts').addEventListener('click', (e) => {
    if (e.altKey) { e.preventDefault(); openScriptsMenu(); } else toggleScripts();
  });
  $('view-scripts').addEventListener('contextmenu', (e) => { e.preventDefault(); openScriptsMenu(); });
  $('diff-prev').addEventListener('click', () => gotoHunk(-1));
  $('diff-next').addEventListener('click', () => gotoHunk(1));
  $('refresh').addEventListener('click', () => reloadAll());
  $('binary-open').addEventListener('click', () => openInMuxy(state.current));
  $('sidebar-toggle').addEventListener('click', () => toggleSidebar());
  // Right-click the toggle to pick which edge the file browser docks to.
  $('sidebar-toggle').addEventListener('contextmenu', (e) => { e.preventDefault(); openSidebarMenu(); });
  $('ref-picker').addEventListener('click', () => openRefMenu());
  $('comments-toggle').addEventListener('click', () => toggleDrawer());
  $('cd-close').addEventListener('click', () => toggleDrawer(false));
  $('send-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleSendMenu(); });
  // Pick up agent-side edits (replies / resolutions) when the tab regains focus,
  // unless the user is mid-edit in a composer/reply (don't clobber their typing).
  window.addEventListener('focus', () => {
    const a = document.activeElement;
    if (a && a.tagName === 'TEXTAREA') return;
    loadComments();
  });
  state.view = loadViewMode();
  // Restore a persisted "forever" scripts grant (the only scripts state that
  // survives a reload — timed windows and per-file opt-ins are session-only).
  if (loadScriptsForever()) state.scriptsUntil = Infinity;
  // Restore the remembered pane layout (sidebar width/open + drawer height/open).
  state.panes.sidebar = loadPane('sidebar');
  state.panes.comments = loadPane('comments');
  wireDivider();
  applySidebarLayout();
  updateSidebarToggle();
  applyDrawerLayout();
  if (state.panes.comments.open) toggleDrawer(true); // reopen the drawer if it was left open
  wireTheme();
  show('placeholder');

  state.root = await resolveRoot();
  // Per-project comments file lives outside the repo, keyed by a hash of root.
  state.storeKey = await hashHex(state.root || 'default', 16);

  // Load the commit history that feeds the ref picker (also used to validate a
  // restored ref below, and to label the picker button).
  await loadCommits();

  // Restore the saved session (active scope + open file + scroll + review ref).
  // Scope, ref, and the pre-selected file must be set BEFORE the tree is built
  // (loadFileList reads state.scope/state.ref/state.restoreFile), so resolve here.
  const session = loadSession();
  if (session) {
    state.scope = session.scope;
    // Only honor a restored ref that still exists in the log (a rebased/dropped
    // commit would otherwise list nothing); fall back to the working tree.
    if (session.ref && state.commits.some((c) => c.sha === session.ref)) state.ref = session.ref;
    reflectScope();
    state.restoreFile = session.file;
  }
  updateRefButton();

  await loadFileList();
  updateRefButton(); // loadFileList resolves the branch name for the "Working tree" label
  await loadComments();

  // Reopen the file and restore its scroll. The tree's initialSelectedPaths only
  // paints the highlight — open the content explicitly (the openFile token guard
  // dedupes any selection-change echo), bring the tree row into view, then scroll.
  if (session && session.file && state.files.has(session.file)) {
    try { state.tree?.scrollToPath?.(session.file); } catch { /* best-effort */ }
    await openFile(session.file);
    restoreScroll(session.scroll);
  }
}

init().catch(reportFatal);
