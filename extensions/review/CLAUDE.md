# review

A full featured code review system for interacting with coding agents.

Muxy extension scaffolded by Muxy.

## What it does

A single **Review** tab (open via the topbar icon or the `Review: Open File Browser`
command) showing a file tree on the left and a code viewer on the right:

- A segmented **[All] / [Changed]** control at the top of the **file-browser pane**
  (`#sidebar-head` — it scopes the tree, so it lives with the tree and hides when the sidebar
  is hidden, rather than in the topbar). Its 49px height matches the content-side
  `#view-toolbar` so the two bottom borders line up across the split.
  - **All** lists every file in the active project, *including* hidden and git-ignored
    files (`find . -type f -not -path './.git/*'`) — or, when a commit is selected in the ref
    picker, every file *as of that commit* (`git ls-tree -r`).
  - **Changed** lists exactly what `git diff --name-only` reports — the working-tree changes,
    or the selected commit's own changes (`git diff <sha>^..<sha>`).
- A topbar **review-ref picker** (`#ref-picker`, next to **Comments**) chooses *what* to review:
  the **Working tree** (uncommitted changes vs HEAD — the default) or any **commit from a
  searchable `git log`** (its diff vs its first parent). Selecting a commit re-drives the whole
  pipeline — file list, file content (`git show <sha>:<file>`), and the inline diff paint — and
  shows the full file with that commit's diff highlighted. See "Review ref" below.
- The tree (`@pierre/trees`) shows git-status badges parsed from `git status --porcelain` (or,
  for a selected commit, from `git diff --name-status`).
- Clicking a file renders it in an embedded, read-only **CodeMirror 6** editor (line-number
  gutter on, syntax highlighting by extension). The selected file is indicated in the tree,
  so the header shows no filename.
- **Git diff line backgrounds.** For files git reports as changed, the editor paints the
  diff inline: added/modified working-tree lines get a green wash + green edge bar. Each
  run of removed lines is **collapsed by default to just a ▸ wedge** in a diff gutter on the
  line it preceded (nothing in the document body, so the file reads top-to-bottom
  undisturbed) — **click the wedge to expand** the removed text (taken straight from the
  diff) and ▾ to re-collapse. Clean/unchanged files paint nothing. The diff gutter is a
  separate column from the comment 💬 gutter, so a line can show both. See "Diff
  highlighting" below.
- **Preview | Source** — for renderable file types (markdown: `md`/`markdown`/`mdx`; HTML:
  `html`/`htm`/`xhtml`) a per-file segmented control appears above the viewer offering a
  rendered **Preview** alongside the CodeMirror **Source**. Renderable files **default to
  Preview**; the choice is a *sticky* preference (one value, remembered in `localStorage`), so
  switching to Source sticks until you switch back. HTML previews are **scriptless by default**
  for safety; a `⚡` toolbar button opts the current file (or, ⌥/right-click, every file for a
  timed window — or forever) into running inline JS. See "Preview" below.
- The tree starts **fully collapsed** (`initialExpansion: 'closed'`); the set of folders the
  user opens is **remembered per (root, scope)** and restored on the next visit via
  `initialExpandedPaths`. See "Expansion persistence" below. A topbar **file-browser toggle**
  (`◧`, `#sidebar-toggle`) sits next to **Comments** and shows/hides the sidebar pane (lit while
  shown, persisted via the pane-layout store). **Right-click that toggle** for a small menu to
  **dock the sidebar to the left or right** edge of the review pane (default left; the choice is
  persisted with the rest of the pane layout). See "Pane layout persistence" below.
- **Picks up where you left off.** The active scope, the open file, and that file's scroll
  position are remembered (per project root, in `localStorage`) and restored when you reopen the
  tab or switch back to it — not the empty placeholder. See "Session restore" below.
- Binary / non-text files show a placeholder with an **Open in Muxy editor ↗** button that
  hands the file to Muxy's native editor (`tabs.open({ kind: 'editor' })`) — that native
  editor is AppKit and cannot be embedded in a webview, which is why the in-tab viewer is
  CodeMirror.
- **Per-line comment threads for agents.** Click a line number (or the 💬 gutter) to leave a
  review note — or **click-and-drag down the line-number gutter to comment on a span of lines**
  (a multi-line *range* thread; the dragged range previews live in an accent wash and clicking
  any line inside an existing range reopens that one thread). **Hovering any line reveals a dimmed 💬**
  in the comment gutter so the feature is
  discoverable. Comments are **batched** — never sent on creation — and each line is a **thread**
  with a status (open/in-progress/resolved/closed) and messages; the agent **replies and resolves**
  by editing the store file, and the tab shows those back. Sending a thread to an agent flips it
  **open → in-progress** (handed off); the agent flips it to **resolved** when done. A line is marked
  by a soft wash + a 💬 gutter marker (the glyph is the same in every status — status reads from
  the wash; the ⟳/✓ glyphs were dropped as too thin to read at gutter size); **hover** to peek the
  thread (no reflow), **click** to pin a popover
  and add/reply/Resolve/**Close**/Send. **Close** dismisses a thread from the tab entirely (it stays
  in the store, hidden, and can be reopened). The bottom **Comments** drawer lists every thread (topbar toggle,
  live count).
  Pressing **Send to agent ▾** offers a permanent
  *✦ New agent* entry (spawns an interactive `claude` in a new terminal) plus the **current
  workspace's Muxy panes** to send into (a pane titled "claude" is ★-hinted). See "Comments"
  below.

Two gotchas the code defends against:
- `[hidden]` is forced to `display: none !important` in `review.css` — otherwise the
  `.empty { display: flex }` rule wins and toggling `.hidden` (placeholder, binary notice,
  "No files") silently does nothing, leaving overlays stuck on top of the editor.
- Binary vs text is decided by `looksBinary()` on a sample (NUL or high control-char ratio),
  and `sh()`/`openFile()` strip a possible trailing NUL terminator from exec output so it
  can't corrupt the last parsed line or trip detection.
- **Exec consent / least privilege:** Muxy keys its "Allow & remember" exec rule on the
  *exact command line*, so a per-file command (`cat <that file>`) re-prompts every time. All
  shell access therefore goes through exactly **FIVE fixed proxy scripts** in `review.js` —
  `LIST_SCRIPT`, `READ_SCRIPT`, `DIFF_SCRIPT`, `STORE_SCRIPT`, `LOG_SCRIPT` — invoked as
  `muxy.exec({ argv: ['sh','-c', SCRIPT], env })`. Every variable input (directory, file,
  mode, **review ref**, comments key/op/content) travels via the `env` (REVIEW_ROOT / REVIEW_FILE /
  REVIEW_MODE / **REVIEW_REF** / REVIEW_KEY / REVIEW_OP / REVIEW_CONTENT) plus a JS-chosen section
  separator (REVIEW_SEP), so each command line stays constant → one "Allow & remember" per proxy.
  Because the approval is bound to the exact script text, a compromised tab can't run anything else
  without a fresh prompt — each grant is exactly: "list a dir (or a commit's tree)", "read a file in
  a dir (or `git show <sha>:<file>`)", "`git diff` one file in a dir (working tree or a commit)",
  "read/write hex-named JSON under `~/.config/muxy/review/`", and "`git log` this repo".
  `READ_SCRIPT` and `DIFF_SCRIPT` refuse absolute paths and `..` traversal; **all three of
  `LIST`/`READ`/`DIFF` refuse any `REVIEW_REF` that isn't pure hex** (it only ever carries a commit
  SHA — same hex-guard idea as `REVIEW_KEY`), so the ref can't smuggle a shell argument or a
  `--upload-pack`-style option; `STORE_SCRIPT` refuses any `REVIEW_KEY` that isn't pure hex (so it
  can only ever touch files inside that one directory). Do NOT reintroduce per-call `{ shell }`
  strings or a generic passthrough — it would both spam prompts and widen the granted capability
  to arbitrary shell. The STORE prompt appears on first tab load (to restore saved comments);
  adding `REVIEW_REF` and the `LOG` proxy changed the LIST/READ/DIFF script text, so each re-prompts
  **once** after this update ships. Agent targeting needs **no** shell at all — see "Comments".

## Expansion persistence

The tree starts collapsed and remembers which folders the user opens.

- **Storage backend — why `localStorage`:** Muxy *does* have a per-extension key/value store
  (the socket verbs `extension.settings.get|key` and `extension.settings.set|key|<json>`,
  backed by `ExtensionSettingsStore.swift`), **but it is reachable only from a `background`
  script over the socket — and this extension declares none** (it's a tab/topbar/command
  extension, which per the manifest docs needs no background process). The tab's injected
  `window.muxy` bridge is frozen with exactly
  `{ extensionID, tabInstanceID, data, theme, onThemeChange, toast, tabs, panes, projects,
  exec, worktrees, events }` — no settings/storage surface — and there is no tab→background
  channel to relay through. So the tab persists to its own `localStorage`, which is durable
  here because the tab is served from a stable custom-scheme origin (`muxy-asset://<ext>`,
  default — non-ephemeral — data store). All access goes through the tiny `store` shim
  (`storeKey`/`loadExpanded`/`saveExpanded`) in `review.js`, so the backend can be swapped
  (e.g. a third exec proxy writing a dotfile) without touching call sites — but that would add
  a consent prompt and widen the exec grant, so prefer `localStorage`.
- **Keyed per (root, scope):** the "All" and "Changed" trees hold different directory sets, so
  they remember their open folders independently and never clobber each other on scope switch.
- **How state is read/written (`@pierre/trees` API):** `onMutation` deliberately drops
  `expand`/`collapse` events (they're "ignored semantic events" → `null`), so we instead use
  the generic `tree.subscribe(() => …)` (fires on any store change) + a debounced save.
  Current state is read by enumerating every directory path implied by the file list
  (`directoriesOf`) and querying `tree.getItem(dir)?.isExpanded()`. Restore is
  `initialExpansion: 'closed'` + `initialExpandedPaths` (constructor) and
  `resetPaths(paths, { initialExpandedPaths })`. Saving is suppressed while a search is active
  (search auto-expands matches and would pollute the saved layout).

## Pane layout persistence

The two resizable panes — the **sidebar** (file browser) and the **comments drawer** — remember
whether they're **open** and the **size** the user dragged them to, across visits. The sidebar
additionally remembers which **side** (left / right) it docks to.

- **Same backend, same rationale as expansion** — `localStorage` (durable under the stable
  `muxy-asset://` origin), behind a tiny shim (`loadPane`/`savePane`, keys
  `review:pane:<sidebar|comments>`). Unlike expansion (keyed per root+scope), pane geometry is
  keyed **globally**: it's window-chrome preference, the same across every project and scope.
- **One shared shape, `{ open, size }`** (the sidebar carries one extra field, `side`), so the
  two panes share all the storage/apply code. `loadPane` only reads/validates `side` when the
  fallback shape has it (`'side' in fb`), so the comments pane stays a clean `{ open, size }`.
  `size` is a px number (sidebar **width** / drawer **height**), or `null` → "use the CSS
  default" (sidebar 280px; drawer `min(45vh, 360px)`). The sidebar's **open** state is now wired
  to a topbar toggle (`#sidebar-toggle` → `toggleSidebar` → `setSidebarOpen`, which flips `open`,
  re-applies via `applySidebarLayout`, and persists) — exactly the one-liner the shared shape was
  built for, **no new storage code**. `updateSidebarToggle` reflects the pressed/lit state and
  tooltip; the button stays lit while the sidebar is shown (mirroring the Comments toggle).
- **Dock side (`side: 'left' | 'right'`, default `'left'`).** Right-clicking the toggle opens a
  small menu (`openSidebarMenu`) offering **Left / Right** (the current edge ✓-ticked); the
  chosen edge is applied by `setSidebarSide` and persisted with the rest of the sidebar pane.
  `applySidebarLayout` toggles a `.sidebar-right` class on **`#app`** (not `#split`, so the
  topbar — a *sibling* of `#split` — can react too) — CSS uses `flex-direction: row-reverse` on
  `#split` (so the visual order becomes content | divider | sidebar), flips the sidebar's
  separating border and the divider's overlap margins to the other side, **and floats the
  `#sidebar-toggle-wrap` past the reload icon** (`order: 10`) so the toggle follows the pane to
  the right edge of the topbar.
  The **width is kept** across a side swap (the clamp bounds are symmetric, ≤70vw). The divider's
  drag **and** arrow-key resize mirror their delta when docked right (`sideDir()` returns `-1`),
  since the handle then sits on the sidebar's *left* edge — dragging left widens it. The menu
  reuses the shared dropdown machinery (`openMenu`/`closeSendMenu`/`menuItem`/`positionFixedMenu`,
  one-open-at-a-time + outside-click/**Esc** dismissal — Esc now wired for the send menu too via
  `onDocKeyForMenu`); its element is `#sidebar-menu` (`.menu.tb-menu`, `position: fixed` like the
  per-row `.cd-menu`) inside the `#sidebar-toggle-wrap` anchor.
- **Constraints are centralized** (`sidebarBounds`/`drawerBounds` + `clamp`) and applied to
  **both** the live drag AND the persisted-value restore, so a size saved on a large window is
  reined in on a smaller one (never wider than 70vw / taller than 85vh, never below the min).
- **When it's written:** the sidebar persists its width on drag-commit (`mouseup`) and on
  arrow-key resize (via `setSidebarSize`); the drawer the same (`setDrawerSize`). The drawer's
  **open** state is owned by `toggleDrawer` (it toggles `hidden` and calls `savePane`); on load,
  `init` restores the height with `applyDrawerLayout` then reopens via `toggleDrawer(true)` if it
  was left open.

## Session restore (open file + scroll + scope)

Switching away from the Review tab and back — or reopening it — restores the **exact** spot you
left: the **active scope**, the **open file**, and that file's **scroll position**, rather than
dumping you on the empty placeholder.

- **Same backend, same rationale as the other prefs** — `localStorage` (durable under the stable
  `muxy-asset://` origin), behind a tiny shim (`loadSession`/`saveSession`/`scheduleSessionSave`,
  key `review:session:<root>`). Keyed **per project root** (not per scope): there is one "current
  file" per project — like the comments store — and scope is itself part of the saved session.
  Shape: `{ file, scroll, scope }` (`scroll` is the CodeMirror `scrollDOM.scrollTop`; `scope` is
  `"all" | "changed"`).
- **What's persisted, and when.** `openFile` writes the session on every open (so the open file is
  always current); `showBinary` writes too (a binary file is still "the open file" — it reopens to
  its placeholder). `selectScope` writes on scope change. The scroll position is the high-frequency
  one, so `onEditorScroll` calls the **debounced** `scheduleSessionSave` (200ms) — note a fresh
  `openFile` saves `scroll:0` (new files start at the top); the debounced scroll save then catches
  up to the real offset as you read.
- **Restore happens in `init`, AFTER root is resolved but BEFORE the tree is built**, because
  `loadFileList` reads `state.scope` and `state.restoreFile`. `init` sets `state.scope` (and
  reflects the `#segmented` buttons) and stashes `state.restoreFile`, then after `loadFileList` /
  `loadComments` it `scrollToPath`s the tree row, `await openFile(file)`s the content, and calls
  `restoreScroll(scroll)`. Skipped if the saved file isn't in the current scope's list (e.g. the
  file was deleted) — you just land on the placeholder.
- **The tree highlight uses `initialSelectedPaths`** (a constructor-only option in `@pierre/trees`
  — `selectPath`/`selectOnlyPath` are NOT exposed on the public `FileTree`, so there is no runtime
  re-select; `resetPaths` on scope switch keeps the user's live selection instead). `loadFileList`
  also **merges the restored file's ancestor directories into `initialExpandedPaths`**
  (`directoriesOf([restore])`) so the selected row is actually visible even if those folders
  weren't in the saved expansion set. The highlight only *paints* — content is opened explicitly by
  `init`, and the **`openFile` token guard** (`state.openToken`, bumped per call, checked after the
  async read) dedupes the case where the initial selection also fires `onSelectionChange` so only
  the last open commits (this also fixes stale reads from rapid file switching generally).
- **`restoreScroll`** sets `scrollDOM.scrollTop` inside `requestMeasure` and **retries a few cycles**
  (up to 8): the doc is set synchronously but laid out a frame later, so a large file's
  `scrollHeight` isn't final on the first measure and the offset wouldn't "take" without the retry.
  No-op for a zero offset.

## Review ref (working tree | a git-log commit)

The whole tab has one **comparison base**, `state.ref`: `null` means the **working tree**
(uncommitted changes vs HEAD — the original, default behavior), and a commit **SHA** means
"review *that commit*" (its diff against its first parent). A topbar **picker** (`#ref-picker`,
to the left of **Comments**) switches between them; the button label reflects the selection
(`Working tree · <branch>` or `<short> · <subject>`) and lights up while a commit is selected.

- **The picker (`openRefMenu`/`renderRefList`/`refRow`).** A searchable dropdown: a `.ref-search`
  input over a scrollable `.ref-list`. The top row is always **Working tree**; below it, up to 500
  commits from `git log` (newest first), each row showing short-SHA · subject · author · relative
  date, the selected one ✓-ticked. Typing filters client-side over short/full-SHA + subject +
  author; **Enter** picks the first match. It reuses the shared one-open-at-a-time / outside-click /
  **Esc** machinery (`openMenu`/`closeSendMenu`) and `positionFixedMenu`, but its body is custom
  (search + list) rather than flat `menuItem`s. The element is `#ref-menu` (`.menu.tb-menu.ref-menu`,
  fixed-positioned) inside the `#ref-picker-wrap` anchor.
- **Selecting a ref (`selectRef`)** sets `state.ref`, **forces an "All" scope to "Changed"** (so the
  sidebar shows the commit's diff — the design choice; you can flip back to "All" to browse the
  whole tree at that commit), rebuilds the file list, and **reopens the current file under the new
  ref** (its content + diff differ) — or lands on the placeholder if that file isn't in this ref's
  tree. Selecting **Working tree** leaves the scope alone. The chosen ref is part of the saved
  **session** and restored on reopen, but only if it still exists in the live `git log` (a rebased /
  amended-away SHA falls back to the working tree, in both `init` and `reloadAll`).
- **The exec layer — one `REVIEW_REF` env across three proxies + a fifth `LOG_SCRIPT`.** With a ref:
  `LIST_SCRIPT` lists `git ls-tree -r` (All) or `git diff --name-only <par> <ref>` (Changed), emits
  `git diff --name-status <par> <ref>` for the badges (parsed by `parseNameStatus`, the
  porcelain-equivalent of `parseGitStatus`), and the short SHA as the "branch" slot; `READ_SCRIPT`
  reads `git show <ref>:<file>`; `DIFF_SCRIPT` runs `git diff -U0 <par> <ref> -- <file>`. The
  **new-file side of that diff is exactly the `git show` content**, so the existing `parseDiff` line
  numbers line up with what's displayed — no diff-engine change. `<par>` = `<ref>^` (first parent;
  sensible for a merge), or the **empty-tree object** (`4b825dc…`) for the root commit, which has no
  parent, so its whole content reads as added. `state.changedSet` (the per-file "has a diff" gate)
  is the commit's changed files, so browsing an unchanged file at that commit paints nothing. Ref is
  **hex-validated** in every script (least-privilege — see "Exec consent"). `LOG_SCRIPT` feeds the
  picker: `git log --max-count=500 --pretty=format:'%H␟%h␟%an␟%ar␟%s'` (fields split on the
  unit-separator byte, so a subject with any punctuation parses cleanly), parsed by `runLog` →
  `state.commits`, loaded in `init` and refreshed by `reloadAll`.
- **Comments are ref-scoped.** A thread carries an optional **`ref`** (the commit SHA; omitted for
  working-tree threads, so existing files don't grow a field and existing ids are unchanged). Its id
  is keyed on the ref too (`sha256(<ref>:<file>:<line>…)`), and `commentsForFile`/`findComment` only
  surface threads whose `ref` matches `state.ref` — so a commit-view thread is painted/edited **only**
  while that commit is selected and never mis-anchors onto a different working-tree line. The drawer
  lists threads from **every** ref (with a `@<short>` badge on the historical ones); clicking such a
  thread's `Lnn` **switches the picker to its ref first** (`jumpTo(file, line, ref)`) so line numbers
  and content match before it scrolls + pins. The outgoing markdown notes `(in commit <short>)` per
  item — the line refers to that commit's version; the captured `snippet` is the durable anchor the
  agent uses against the current tree. (Design note: an earlier option was a single global thread
  that paints everywhere; ref-scoping was chosen because cross-ref line numbers don't line up, so a
  global thread would mis-paint when you switch base.)

## Diff highlighting (git diff line backgrounds)

The CodeMirror viewer paints each changed file's `git diff` inline, the same way the comment
layer works — **purely decorative**, fed by a `StateEffect`, no document reflow risk beyond the
deletion widgets (which are expected to add rows, unlike comments).

- **Fetch — a fourth fixed proxy.** `DIFF_SCRIPT` (see "Exec consent" above) runs
  `git diff --no-color --no-ext-diff -U0` for **one** file: `git diff HEAD -- <file>` for a
  tracked file (covers staged + unstaged), or `git diff --no-index -- /dev/null <file>` for a
  file git doesn't track yet (untracked / brand-new) so every line reads as added. `-U0` (zero
  context) keeps hunks tight so the parser only sees changed lines. `runDiff(path)` invokes it;
  `loadDiff(path)` (called from `openFile` after `setDoc`) **only fetches for files in
  `state.changedSet`** — the set of paths `git status --porcelain` reported as non-deleted,
  built in `loadFileList`. Clean files skip the exec entirely and paint nothing. The fetch is
  **race-guarded**: a diff that resolves after the user has navigated away (`state.current !==
  path`) is dropped, and `openFile` dispatches an empty diff synchronously so a stale diff never
  flashes on the next file.
- **Parser — `parseDiff(text)`.** Walks the unified diff into `{ added:Set<newLineNo>,
  deletions:Map<newLineNo, string[]> }`. `+` lines join `added`; `-` lines accumulate and flush
  (anchored to the new-file line they sit ABOVE) when the run ends — so a modification (`-old`
  then `+new`) yields both a green added line and a red deletion above it. Hunk headers reset the
  new-file counter; a pure-deletion header (`+c,0`) anchors the removal before line `c+1` (i.e.
  after line `c`). Trailing deletions anchor past doc end and the deco builder clamps them to
  render after the last line.
- **Decorations (`diffData` + `diffDeco` StateFields).** `diffData` holds `{ added, deletions,
  expanded }` — `expanded` is the Set of deletion anchor lines the user has opened. `setDiffEffect`
  replaces added/deletions and **resets `expanded`** (everything starts collapsed);
  `toggleDiffEffect` flips one anchor in/out of `expanded`; `diffDeco` rebuilds on either. Added
  lines get a `Decoration.line` (`.cm-diff-add-line` — green wash + green inset edge bar). A
  **collapsed** deletion renders **nothing in the body** (`buildDiffDeco` skips it) — the only
  marker is its gutter wedge, so the document is undisturbed. An **expanded** deletion renders a
  block `Decoration.widget` (`side:-1`, or `+1`/clamped for a deletion past doc end) holding a
  `DeletedLinesWidget` (red rows `.cm-diff-deleted-line`, inert so the text stays selectable —
  collapse via the gutter). `WidgetType` is re-exported from `lib/codemirror.js` (already in the
  export list). `diffExtensions()` is added to `baseExtensions` ahead of
  `commentExtensions()`; where a line is both commented and added, the diff wash wins by CSS
  source order (the comment 💬 gutter marker still shows).
- **The diff gutter (`diffGutter`, behind `diffGutterCompartment`) is the only deletion marker.**
  A `gutter()` paints a wedge on each deletion's render line — `.cm-diff-wedge` ▸ (collapsed) / ▾
  (expanded) — and its `domEventHandlers.click` toggles the anchor (`deletionAnchorAtLine` maps the
  clicked line back to its anchor; `deletionRenderLine` is the shared clamp used by the deco, the
  marker, and the click map so they always agree). It's a **separate gutter column** from the
  comment 💬 gutter, so a line that both anchors a deletion and carries a comment shows both
  markers side by side (they mean different things: "removed above here" vs "comment on this
  line"). The column would otherwise reserve left-chrome on every file, so it lives in a
  **Compartment**: `openFile` reconfigures it to `[]` (no column) up front, and `loadDiff`
  reconfigures it to `diffGutter` **only when `diff.deletions.size`** — clean files and
  pure-addition files carry no extra gutter.
- **No on/off toggle.** Diff paint itself is always on because it's keyed to whether git reports
  the file as changed — unchanged files are a no-op (no exec, no gutter). The per-run
  collapse/expand is the only interactive control. A future global control or a three-way
  add/change distinction would live alongside `state.changedSet`.
- **Hunk navigation (↑/↓ in the view toolbar).** A long file scatters its changes, so the
  `#view-toolbar` grows a `#diff-nav` group — `↑`/`↓` buttons plus an "N changes" count — that
  jumps the viewport between change hunks. A **hunk** is a contiguous run of change lines:
  `diffHunkLines(diff)` unions the `added` line numbers with each deletion's anchor line, sorts
  them, and collapses adjacent lines (gap ≤ 1) into one stop, keeping only each hunk's **start
  line** in `state.diffHunks`. `gotoHunk(dir)` compares **document-pixel offsets**
  (`hunkTop(ln)` = `view.lineBlockAt(...).top`) against a reference of
  `scrollDOM.scrollTop + NAV_MARGIN` — recomputed fresh each press, so manual scrolling never
  desyncs — and scrolls to the next hunk below (or last above), **wrapping** at the ends. It's
  pixel-based, *not* `posAtCoords`: hit-testing the scroller's top-left corner lands in the
  gutter/padding and returns `null`, which is what broke the ↑ button. `NAV_MARGIN` (32px) is
  both the `scrollIntoView` `yMargin` AND the +slop in the reference, so the just-jumped hunk
  (parked 32px down) is excluded from the next search and repeated presses always advance instead
  of sticking. `loadDiff` fills `state.diffHunks` and calls `updateToolbar()`; the nav group is shown
  iff there are hunks, independently of the Source/Preview segmented control (so a plain code file
  with diffs shows only the arrows, a clean markdown file shows only Source/Preview, a changed
  markdown file shows both). The whole `#view-toolbar` is now shown when **either** is present.
  Next natural step (the user flagged it): a "collapse unchanged regions" toggle alongside.

## Comments (per-line review notes for agents)

Each line holds a **thread** (status + a list of messages). The single interaction surface is a
floating **popover** (no inline composer / no block widgets, so the document never reflows):
**hover** the 💬 gutter marker to peek the thread (read-only); **click** the marker or the
line number to **pin** the popover open and interact — type the first comment on a fresh line,
or reply / Resolve-Reopen / Send-to-agent on an existing thread. Commented lines also get a soft
wash (yellow = open, green = resolved), and the bottom **Comments** drawer lists every thread's
*initial* comment as an overview (click `Lnn` to jump + open its popover).

- **Persistence — why `~/.config/muxy/review/`, not the repo.** Comments must be readable AND
  writable by an agent, so they live on disk (not `localStorage`). But they must NOT get
  committed, so the store is **outside** any repo: `~/.config/muxy/review/<sha256(absRoot)>.json`,
  one file per project, named by a hash of the project root. Each thread's `id` is
  `sha256(relpath:line)` truncated (or `sha256(relpath:line-endLine)` for a range) → **one thread
  per (file, line[, endLine])** (re-commenting the same spot edits its root message). A
  **multi-line range** thread carries an optional **`endLine` (> `line`)** — omitted on single-line
  threads so existing files don't grow a field; `endLineOf(c)`/`rangeLabel()` centralize the
  "effective last line" and the `"42"` / `"42–45"` label. `findComment(file, line, endLine)`
  matches an **exact range** when given `endLine`, else returns the thread whose range **covers**
  the point — so a single click inside a range opens that one thread instead of forking. The line
  wash and the "commented" hint-suppression set span **`line..endLine`**; the 💬 gutter marker sits
  on the **start line** only. The drag preview is a separate `dragRangeField`/`setDragRangeEffect`
  decoration (accent wash) painted while the gutter mousedown→move→up gesture is in flight
  (`lineNumberDragHandlers` — down→up with no movement is just a click; edge auto-scroll lets a
  range extend past the viewport). **Format is JSONC** (v2): `persistComments` writes a documented header
  comment — including a **complete worked example** of a resolved thread so the format is
  obvious to an agent reading the file (kept as a comment, not a fake `comments[]` entry, so it
  never pollutes the UI and self-heals on the next tab write) — followed by the JSON;
  `loadComments` runs `stripJsonc` (a string-aware `//` and `/* */`
  stripper — verified to preserve those sequences *inside* string values) before `JSON.parse`,
  so an agent may leave comments in the file and plain-JSON edits still parse. Shape:
  `{ version: 2, root, updatedAt, comments: [{ id, file, line, snippet, status, createdAt,
  sentAt, messages: [{ author, body, at }] }] }` — `status` is
  `"open" | "in-progress" | "resolved" | "closed"`, `author` is `"user" | "agent"`. A thread made
  while a historical commit is selected also carries **`ref`** (that commit's SHA) and an optional
  **`endLine`** (range threads); both are omitted in the common (working-tree, single-line) case so
  existing files don't grow fields. Comments are **ref-scoped** — see "Review ref" above. Sending a
  thread to an agent flips `"open" → "in-progress"` (in `stampSent` — the handoff); the agent
  flips it to `"resolved"` when done. A `"closed"` thread is **dismissed**: kept in the store but
  hidden from every tab surface (gutter marker, line wash, drawer, count, and the outgoing
  batch) by the `isVisible(c)` filter — set `status` back to `"open"` to bring it back. `normalizeComment` migrates v1 (`body`) → `messages[0]` on
  load. `snippet` is the line's text at comment time so the spot is locatable if lines drift.
  Reads/writes go through `STORE_SCRIPT` (see exec-consent note). Deliberately a *different*
  backend from tree-expansion `localStorage` — expansion is tab-private UI state; threads are an
  artifact an external agent reads and writes.
- **CodeMirror integration is purely decorative** — no widgets at all. One `StateField`
  (`commentData`, fed by `setCommentsEffect`) holds the open file's comments; `commentDeco`
  derives a `Decoration.line` wash per commented line (yellow `.cm-commented-line`, or green
  `.cm-resolved-line` when resolved, blue `.cm-inprogress-line` when in-progress) — never a block
  widget, so layout never shifts. A dedicated
  `gutter()` paints the marker — always 💬, with the status as a CSS class (status reads from the
  line wash, not the glyph) — carrying the comment `id`; its
  `markers(view)` re-runs every `ViewUpdate`, refreshing when `setCommentsEffect` fires.
  - **Hover hint (discoverability).** The same gutter also paints a dimmed, grayscale 💬
    (`.cm-comment-dot.hint`, a singleton `CommentHintMarker`) on the line the pointer is over,
    *unless that line already has a thread*. The hovered line lives in `hoverLineField`, fed by
    `setHoverLineEffect` from mousemove/leave listeners (`wireHoverHint`) that map cursor coords →
    line via `view.posAtCoords` and **dispatch only when the line number actually changes** (so
    constant mousemove doesn't churn). The hint is display-only — clicking it goes through the
    gutter's existing shared click handler (`onLineActivate`), the same path as a real marker.
- **The popover (`pinPopAt`/`renderPinned`) is plain DOM over the editor**, not a CM widget, so
  it can't reflow the document. It's keyed by `(popFile, popLine)` — not a comment id — so it
  survives the **create→thread transition**: on a line with no comment it shows a "new comment"
  input that calls `upsertComment`; once created (or for an existing thread) the same popover
  re-renders into thread + reply (`addReply`) + Resolve/Reopen + **Close** (`setStatus`) + Send.
  **Close** dismisses the thread (`status:'closed'`) and dismisses the popover; since a closed
  thread paints no gutter marker, the only way back to it is clicking its **line number** — the
  popover then offers a lone **Reopen** (`upsertComment`/`findComment` still see closed threads,
  so re-commenting the line reopens the existing thread rather than forking a duplicate id). Hover uses
  the read-only `.comment-pop.preview` variant (`pointer-events: none`); click pins it
  (`pointer-events` on, outside-click/Esc to dismiss, closes on editor scroll). `refreshComments`
  re-renders an open pinned popover so agent replies/resolutions (pulled in on focus) appear live.
  CM exports used (`Decoration`, `gutter`, `GutterMarker`, `StateField`, `StateEffect`,
  `RangeSet`) are re-exported from `lib/codemirror.js` — **add any new symbol to that file's
  re-export list before importing it in `review.js`** (esbuild bundles it straight from the
  `@codemirror/*` packages in `node_modules`; no separate vendor step).
- **Sending — never on creation.** "Send to agent" builds markdown (`buildMarkdown`) from the
  **open** threads only (resolved ones are done; in-progress ones were already handed off),
  grouped by file, each item carrying its `id`
  and full message thread, with a footer telling the agent **how to write back**.
  `buildMarkdown(subset)` takes an **optional array** — given one it sends exactly
  those threads (any status except `closed`); given nothing it falls back to all-open. Likewise
  `stampSent(subset)`, `sendToNewAgent(only)`, and `sendToRunningPane(id,label,only)` accept an
  optional single comment so the **per-row send** (below) reuses the same delivery path as the
  drawer-wide send. **`stampSent` flips each `open` thread to `in-progress`** (resolved/closed
  re-sends keep their status) and stamps `sentAt`. It is called **optimistically — *before* the
  async delivery** (build the markdown first, since `buildMarkdown(null)` selects `status:'open'`
  and this flips those threads), so the drawer/gutter update **live** while the user is still on
  the tab; delivery typically opens/activates another pane and backgrounds the Review tab, so a
  refresh *after* delivery wouldn't be seen until they returned. `stampSent` returns a **revert
  fn** (it snapshots prior status/sentAt) that each send path calls if delivery fails, rolling the
  flip back. The footer tells the agent to edit the
  JSONC file at `~/.config/muxy/review/<key>.json`, append an `{author:'agent', body, at}`
  message to the thread's `messages`, and set `status:'resolved'` (or leave `in-progress` + an agent
  note if it can't). **Why Muxy-only:** delivering to a running agent means
  typing into its terminal, and macOS **blocks `TIOCSTI`** (the only OS-level "fake terminal
  input" call) — verified: `EPERM` even injecting into a PTY we created ourselves. Input into a
  terminal program is owned by whoever holds the PTY *master* fd (the terminal app), which we
  can't get. Muxy hands us that via `panes.send`; other apps would each need their own
  automation (Terminal/iTerm AppleScript) or a clipboard hand-off, so we deliberately scope to
  Muxy panes only.
  - **Targeting = just `panes.list()`** (`listWorkspacePanes`). It returns **every pane in the
    app** (NOT workspace-scoped), each `{ workingDirectory, title, isFocused, id }` (read
    case-insensitively via `pickCI` — Muxy returns `WORKINGDIRECTORY`/`TITLE`/`ID`). **No TTY,
    no pid** — so there is no reliable pane→process join, and earlier attempts to synthesize one
    (TTY match, then `lsof` cwd match) were guesswork that kept misfiring. So we don't classify:
    we **filter to the current workspace by path** — keep panes whose `workingDirectory` is the
    active project root (`state.root`) or under it (`normPath` strips trailing slashes) — and let
    the user pick (delivery is `panes.send(pane.id, …)`). A pane whose `title` literally names
    "claude" gets a ★ hint (reliable, never misleading); others get •. Our own Review tab
    (`title === 'Review'`) is dropped. **History note:** don't reintroduce `ps`/`lsof`/TTY
    detection — it's not derivable from what `panes.list()` exposes, and chasing it caused real
    churn; the pane's own `workingDirectory` is the path, no process lookup needed.
  - **✦ New agent is always offered** at the top (it spawns a fresh terminal).
  - **New agent:** stage the markdown as `<key>.prompt` via `STORE_SCRIPT`, open a terminal
    (`tabs.open({kind:'terminal'})`), poll `panes.list()` for the new pane, then
    `panes.send(id, 'cd <root> && claude "$(cat <prompt>)"')` **then `sendKeys(id, 'Enter')`** to
    actually submit it. Like the running-pane path, do NOT append a trailing `\n` to the
    `panes.send` payload — it lands as a literal unsubmitted newline, not a command run; the
    `sendKeys` Enter is what runs the line. Command substitution feeds the
    full markdown as claude's **first interactive message** with zero shell-quoting of the
    comment text (it's *interactive*, not `claude -p`).
  - **Running agent:** `panes.send(id, md)` then `sendKeys(id, 'Enter')`. **Do NOT** wrap the
    markdown in bracketed-paste markers (`ESC[200~ … ESC[201~`) — `panes.send` already delivers
    multi-line text as one block (newlines are not submitted line-by-line), so the markers are
    not consumed and instead land as literal `[200~`/`[201~` text in the agent's message
    (confirmed in testing). Send the raw markdown.
  - On send, comments are stamped `sentAt` (kept, so you can re-send
    or send to a second agent) and the drawer shows a "sent ⟨time⟩" hint (the stamp + the
    in-progress flip happen up front via `stampSent`, reverted only if delivery throws). To get a thread off
    the list, **Close** it — either from its popover or via each drawer card's **✕** (both call
    `setStatus(id, 'closed')`; hidden but reopenable by clicking its line number). The drawer ✕ is
    deliberately a *close*, not a delete — outright deletion only happens by clearing a comment's
    text in the popover (`removeComment`). There is deliberately no bulk "clear sent" — Close is the dismiss path.
  - **Per-row send (`renderDrawer`).** Every drawer card carries its own **Send ▾** button
    (`.cd-send`) that is hidden until you **hover** the row (revealed via CSS
    `.cd-item:hover .cd-send`, plus `:focus-visible` and a `.menu-open` class so it stays put
    while its menu is open). Clicking it opens the **same** ✦-New-agent / pick-a-pane menu but
    scoped to **that one thread** (`sendToNewAgent(c)` / `sendToRunningPane(id,label,c)`), so you
    can dispatch a single comment without sending the whole batch. The menu machinery is shared:
    `showSendMenu(menuEl, wrapEl, {onNew, onPane, anchorEl})` populates any (menu, wrap) pair and
    a single module-level `openMenu` enforces one-open-at-a-time + outside-click/Esc dismissal.
    Because a per-row menu lives **inside the scrolling `#cd-body`** (which would clip an
    absolutely-positioned dropdown), an anchored menu goes `position: fixed` and is placed by
    `positionFixedMenu` against the button rect — right-aligned, opening upward when there's room
    (else downward), clamped to the viewport, re-placed once panes load, and closed on drawer
    scroll. The drawer-wide `#send-menu` passes no `anchorEl`, so it keeps its CSS-absolute
    placement in the (non-scrolling) header.
- **Threading & resolution.** The drawer card shows the full thread (user/agent messages), a
  status pill, a **reply** box (`addReply(id,'user',…)` — a user reply reopens the thread), and a
  **Resolve/Reopen** toggle (`setStatus`). The agent does the same by editing the JSONC file
  (including writing `status:"closed"` to dismiss, or back to `"open"` to surface a thread again).
  To surface those agent-side edits, the tab **re-reads the store on `window` focus** (and on the
  ↻ button), skipped while a `<textarea>` is focused so it never clobbers in-progress typing.
  Concurrency is last-write-wins (tab writes are debounced; agent writes are occasional) — fine
  in practice; the focus-refresh keeps the tab current. **Write-pending guard:** because the
  focus-reload reads disk, a debounced local write that hasn't landed yet would be overwritten by
  the stale file — this is what made a just-sent thread snap back from `in-progress` to `open` on
  return to the tab. `persistComments` raises `state.commentWritePending` for the whole
  queued+in-flight window (cleared in the write's `finally`, gated by a `commentSeq` token so only
  the latest write clears it) and `loadComments` **bails while it's set**. The send path calls
  `persistComments(true)` to flush synchronously (bypassing the 120ms debounce) so `in-progress`
  reaches disk before the agent — or a focus-reload — reads it.

## Preview (rendered markdown / HTML)

For renderable files the viewer offers a **Source / Preview** toggle. `previewKind(path)`
classifies by extension (`md`/`markdown`/`mdx` → `markdown`; `html`/`htm`/`xhtml` → `html`;
everything else → `null`). The `#view-toolbar` (above `#viewer`) hosts the `.vseg` segmented
control; that control is shown only when `state.currentKind` is non-null — code files look
exactly as before. (The toolbar itself can also appear for the diff-nav arrows even on a code
file — see "Hunk navigation" under "Diff highlighting".)

- **Layout.** `#content` is a flex **column**: the toolbar (auto height) over `#viewer` (the
  `position:relative` flex row). `#viewer` holds three stacked things: the CodeMirror
  `#editor-mount` (kept **in layout**, visibility-toggled, never `display:none`, so CM keeps
  its measurements and never needs a re-measure on toggle), and two **absolute `inset:0`
  overlays** — the `#preview-mount` iframe and the existing placeholder/binary panels. `show()`
  picks exactly one of `placeholder | binary | editor | preview`; the preview iframe stacks
  over the (hidden) editor when active. The source is **always** loaded into CodeMirror on
  open (regardless of mode) so toggling to Source is instant and per-line comments still map.
- **Sticky preference, defaults to Preview.** `state.view` (`'source' | 'preview'`) is a single
  value persisted to `localStorage` (`review:viewmode`) — same backend/rationale as tree
  expansion. `loadViewMode()` returns `'preview'` unless the stored value is exactly `'source'`,
  so renderable files open rendered by default and **only an explicit toggle to Source (written
  immediately by `setViewMode`) overrides it** — and that choice is then restored on the next
  visit. Switching to a non-renderable file shows Source and hides the toolbar but **leaves the
  preference intact**, so the next renderable file re-renders. `applyView()` is the one place
  that maps (`currentKind`, `view`) → `show(...)`; `openFile` calls `updateToolbar()` then
  `applyView()`.
- **Sandboxing — content under review may be hostile.** Both kinds render inside an iframe whose
  `sandbox` is set **per render** (`renderPreview`). The default — and markdown **always** — is
  `sandbox=""` (the *empty* token list = maximum restrictions: **no scripts**, opaque origin,
  no form submission, no top-navigation). Inline CSS still applies, so markup/tables/text/inline
  styles render, but any embedded `<script>`/`onclick=` is inert and can't reach the parent — so
  **no separate HTML sanitizer is needed**. The trade-off: relative external assets (linked
  CSS/JS, images by relative path) don't load (opaque origin + sandbox), so HTML preview shows
  structure and inline styling, not a fully-resourced page. This is deliberate for a review tool.
- **Scripts in HTML previews (opt-in).** Authored HTML that relies on inline JS (e.g. `onclick=`
  links) needs scripts to run. A `#view-scripts` toolbar button (shown only for HTML files,
  between the diff-nav and the Source|Preview control) lets the user opt in — and even then the
  iframe gets `sandbox="allow-scripts"` **alone** (no `allow-same-origin`), so the page keeps an
  opaque origin and still can't touch the parent tab's DOM/cookies/storage. **Plain click** opts
  the **current file** in (per-file); **⌥-click / right-click** opens a small menu
  (`openScriptsMenu` — reuses the shared `openMenu`/`positionFixedMenu` machinery) to enable
  scripts for **every** HTML preview for a **timed window** — presets 10/30/60m plus a remembered
  custom value, and **custom…** swaps the menu body to an inline minutes input (**not**
  `window.prompt`, which would freeze the whole webview/bridge) — or **forever** (always on). The
  button is **lit** (`aria-pressed="true"`) and labelled `⚡ Scripts on` / `⚡ Scripts on · Nm` /
  `⚡ Scripts on · always` while active; a plain click while on is a **global kill-switch** (clears
  the file's opt-in, any running window, *and* a persisted forever grant).
  `scriptsAllowed(path)` gates `renderPreview`'s sandbox; a `setInterval` (`onScriptTick`, 15s)
  keeps the timed-window countdown fresh and **re-renders to revoke scripts** when the window
  lapses (forever needs no tick). **State model — `state.scriptsUntil`:** `0` = off, a future ms
  timestamp = timed window, **`Infinity` = forever**. **Persistence:** the chosen window *length*
  (`review:scriptwindow`) AND a **forever** grant (`review:scriptsforever`, restored in `init` via
  `loadScriptsForever`) are remembered; per-file opt-ins and a *timed* window are deliberately
  **session-only** (a timed grant silently surviving a reload would be surprising and unsafe, but
  *forever* is an explicit, deliberate, clearly-labelled standing choice — like the Source/Preview
  preference — so it persists until turned off). `startScriptWindow`/`endScriptWindow` both clear
  the persisted forever flag (a timed window supersedes it; turning off clears everything).
- **Markdown rendering.** `lib/markdown.js` (the `marked` parser — an npm dependency — exported as
  `renderMarkdown`, GFM on) turns the source into HTML. `renderPreview` wraps it in
  a full document with a GitHub-flavored stylesheet (`markdownCss`) themed with **literal**
  colors resolved from the live `--muxy-*` variables (`themeColors()` reads them via
  `getComputedStyle` — CSS variables don't cascade into a separate iframe document). Because
  the colors are baked in, `wireTheme` **re-renders the markdown preview on theme change**.
- **HTML rendering.** Authored HTML is dropped into `srcdoc` **as-is** on a white backdrop (so a
  page renders as a browser would); no theme styling is injected.
- **Comments in preview.** Per-line comments are a Source-view affordance (the line-number /
  💬 gutters). Preview has no gutter, so you add/edit line comments in Source; the drawer and
  existing washes are unaffected. (A future hook: anchor comments to rendered nodes.)

## Layout

- `manifest.json` — declares the extension to the **locally-installed Muxy app**, which loads
  this directory from `~/.config/muxy/extensions/review/` and resolves every relative path
  (`tabs/review.html`, `assets/*`) against the extension root. Needs `panes:read`/`panes:write`
  for the send flow, on top of `tabs`/`projects`/`worktrees`/`exec`/`notifications`. This is a
  **tab/topbar/command** extension, so it declares **no `background` script** — all logic lives in
  the tab. **The manifest body is duplicated, byte-for-byte, in `package.json`'s `muxy` block**
  (the marketplace source of truth — see Build). The layout mirrors between root and `dist/`, so
  the *same* relative paths work in both; keep the two manifests in sync if you change a path or
  permission.
- `package.json` — the **marketplace** manifest + build entry (the `muxy-app/extensions`
  pipeline reads this, not `manifest.json`). `name`/`version`/`description` at top level; the
  manifest body (permissions, tabTypes, commands, topbarItems, marketplace listing) under the
  `muxy` key (no `$schema`/`name`/`version` inside it — the validator flattens
  `{...muxy, name, version}` against an `additionalProperties:false` schema). Declares the `build`
  script, the runtime libraries as `dependencies` (CodeMirror 6 packages, `@pierre/trees`,
  `marked`), and `esbuild` as a devDep. `package-lock.json` is committed (CI requires it — the
  marketplace build runs `npm ci` from it).
- `README.md` — the marketplace/store readme (description + per-permission justification).
- `assets/review.svg` — topbar glyph (`currentColor`, tinted by the chrome).
- `assets/icon.svg` — the 256-canvas marketplace listing icon (self-colored).
- `tabs/review.html` / `review.css` — the tab shell and styling (themed entirely with
  `--muxy-*` variables; the tree is themed via `--trees-*-override`).
- `tabs/review.js` — **source** for the tab logic (ESM). Edit this.
- `tabs/review.bundle.js` — **build artifact** (gitignored): a classic-script IIFE bundling
  `review.js` plus its npm dependencies. The HTML loads this (classic `<script>`, so there's no
  ES-module / `file://` scheme risk in the webview). Do not edit by hand; regenerated by
  `scripts/build.sh` / `scripts/build.mjs`. **Not committed** — shipping minified source trips the
  store's readable-source check.
- `lib/codemirror.js` — thin adapter re-exporting from the `@codemirror/*` packages and defining
  `languageFor` (extension → CM language). One esbuild pass keeps a single `@codemirror/state`
  instance (core + many languages). Readable source — edit freely.
- `lib/trees.js` — thin adapter re-exporting `FileTree` (& friends) from `@pierre/trees`.
- `lib/markdown.js` — thin adapter exporting `renderMarkdown` (built on `marked`, GFM on).
  Powers the markdown Preview.

## Build

There are **two build tracks** — local dev (loads from the repo root) and marketplace (ships a
`dist/`). They share one source (`tabs/review.js` + the `lib/` adapters) and one set of npm
`dependencies`; the bundle is produced at build time, never committed. **Run `npm install` once**
to populate `node_modules` before either track (the marketplace pipeline does this for you via
`npm ci`).

- `scripts/build.sh` — **local dev**: rebuilds the root `tabs/review.bundle.js` from
  `tabs/review.js` (bun, IIFE — resolving the libraries from `node_modules`) **and then regenerates
  `dist/`** (it calls `scripts/build.mjs`), because the locally-installed Muxy serves this extension
  from **`dist/`** (see the ⚠️ gotcha under "Editing"). **Run this after editing `review.js` (or a
  `lib/` adapter), then Reload in Muxy.**
- `scripts/build.mjs` (`npm run build`) — **marketplace**: assembles `dist/` (esbuild bundles
  `review.js` + its dependencies from `node_modules` → `dist/tabs/review.bundle.js`, then copies
  `review.html`, `review.css`, `assets/*`, **and `package.json`**, mirroring the root layout). The
  pipeline **requires the manifest (`package.json`) inside `dist/`** — build hard-fails otherwise
  (`build did not emit 'package.json' into 'dist/'`) — so `dist/package.json` is the one piece of
  the source tree that intentionally ships. Offline-safe at build time (esbuild reads only
  `node_modules`): the store pipeline runs `npm ci --ignore-scripts` (registry access, installs the
  locked dependency tree) **then** `npm run build` with `npm_config_offline=true`, so no network is
  used during the bundle. `dist/` is **gitignored** — it's regenerated and is the *only* thing the
  marketplace packs/ships, so raw source, `lib/`, `node_modules/`, `CLAUDE.md`, `.claude/`,
  `scripts/`, etc. never reach users (only the bundled runtime + `package.json` do). **Deliberately
  single-purpose and offline** — it only emits `dist/`; the fork-simulation lives in `preflight.mjs`,
  not here, so CI's `npm run build` stays fast and network-free.
- `scripts/preflight.mjs` (`npm run preflight`) — **local pre-flight**: runs this extension
  through the *real* `muxy-app/extensions` tooling (build → validate → pack --dry-run) without
  hand-forking. It clones (and refreshes) that repo into a cache under the OS tmpdir —
  **realpath'd**, because macOS `/tmp → /private/tmp` would otherwise break the tooling's
  `process.argv[1] === import.meta.url` self-invoke guard (build/pack are guarded; validate is
  not) and `main()` would silently no-op — stages a copy of us into `extensions/<name>/` (minus
  the regenerated/gitignored artifacts — `node_modules`/`dist`/`.git`/`vendor`/the root
  `tabs/review.bundle.js` — so the staged tree mirrors what the PR actually commits, and
  validate.mjs doesn't false-alarm on a locally-built minified bundle), then drives the tooling. It also **independently validates the
  raw `package.json` against the live `muxy-app/muxy` schema**: as of this writing the tooling on
  `main` *flattens* the manifest to `{...muxy, name, version}` before validating, which disagrees
  with the current schema (it requires top-level `name`/`version`/`scripts`/`muxy`) and so fails
  for *every* extension — the independent check is the trustworthy signal (`package.json` PASSes
  it). Needs git + network; not part of CI.

The bundle (`tabs/review.bundle.js`) and `dist/` are **build artifacts, not committed** — they're
regenerated from `tabs/review.js` + the `lib/` adapters + the npm `dependencies`. The
locally-installed Muxy serves the extension from **`dist/`** (it resolves the tab entry to
`dist/tabs/review.html`; a relaunch errors if `dist/` is missing — see the ⚠️ gotcha under
"Editing"). That's why `scripts/build.sh` regenerates `dist/` too — so the served tree stays
current. The shipped copy is rebuilt into `dist/` from source.

### Publishing to the marketplace

**First, locally:** `npm run preflight` runs the whole pipeline (build → validate → pack) against
the real tooling and reports an independent schema verdict — do this before forking.

Then fork **`muxy-app/extensions`**, copy this directory to `extensions/review/` (dir name must
equal `package.json` `name`), and from the fork root: `npm install` (inside `extensions/review/`),
`node scripts/build.mjs review`, `node scripts/validate.mjs review`,
`node scripts/pack.mjs --dry-run review`, and open a PR. CI runs the same build → validate →
(on merge) pack/sign/upload; only `dist/` is shipped. **Blocker:** validation hard-requires
`assets/screenshot-1.png` at **exactly 1600×1000** (PNG, ≤3MB) — capture a real screenshot of the
Review tab before submitting; the manifest already references it.

## Future hooks (already designed for)

- **Writable editor:** drop the `EditorState.readOnly` / `EditorView.editable.of(false)`
  lines in `baseExtensions()` and wire a save path.
- **Rendered Preview (markdown / HTML):** ✅ shipped (see "Preview" above). The **`allow-scripts`
  opt-in for trusted pages** is ✅ shipped too — per-file or a timed window, see "Scripts in HTML
  previews" under "Preview". Natural extensions left open: more renderable kinds (SVG, CSV,
  notebooks), a `<base>`/asset-resolver so relative HTML resources load (an `allow-same-origin`
  step would be needed for that, and weighed against the opaque-origin guarantee), and anchoring
  comments to rendered nodes so Preview can show/add threads too.
- **Per-line comment threads + resolve/reply:** ✅ shipped (see "Comments" above). **Multi-line
  *range* comments** ✅ also shipped (click-drag the line-number gutter; `endLine` on the model).
  Natural extensions left open: live position tracking so a thread follows edits (currently
  pinned to `line`/`endLine` + `snippet`), and live store-change watching (currently re-read on
  focus, not push).

## Editing

After changing `manifest.json` or any tab asset, click "Reload" in the
Muxy Extensions modal to pick up the changes. Remember to run `scripts/build.sh` first if
you edited `tabs/review.js`. If you change a path, permission, or listing field, mirror the edit
into `package.json`'s `muxy` block (the marketplace manifest) so the two stay in sync.

**⚠️ Gotcha — Muxy serves this extension from `dist/`, so keep `dist/` built and current.**
The locally-installed Muxy resolves the tab entry to **`dist/tabs/review.html`** — a full
quit+relaunch with `dist/` missing fails outright (`Tab type 'review' entry not found at
…/review/dist/tabs/review.html`). So editing root source and rebuilding *only* the root
`tabs/review.bundle.js` is **not** enough — your changes won't appear, because Muxy is serving the
stale `dist/`. **`scripts/build.sh` now rebuilds BOTH** the root bundle **and** `dist/` (it calls
`scripts/build.mjs` at the end), so a single `scripts/build.sh` + Reload keeps the served tree
fresh. **Do NOT delete `dist/`** to "force root loading" — an in-modal *Reload* may transiently
fall back to root, but a real relaunch hard-expects `dist/` and errors without it (this cost a
debugging session: first a new toolbar button never rendered because `dist/` was stale, then a
relaunch broke entirely after `dist/` was removed). The empirical rule is simply: **`dist/` must
exist and be current** — `scripts/build.sh` (or `npm run build`) ensures that. A fast way to tell
the live tree is stale during diagnosis: drop a unique static (script-free, so no CSP issue)
marker in `tabs/review.html`, rebuild, and check whether it appears.

## Skill

Coding agents in this directory should consult the `muxy-extension`
skill in `.claude/skills/` or `.agents/skills/` before generating
manifest or runtime changes.