# Files

File explorer and code editor for Muxy, built with vanilla JavaScript,
CodeMirror 6, and Vite on top of `muxy.files`, `muxy.git`, and `muxy.tabs`.

```bash
npm install
npm run build   # -> dist/, then Reload the extension in Muxy
npm test
```

On Muxy versions with file-type routing, Files registers its supported source,
text, configuration, Markdown, image, and PDF types automatically. Unsupported
types go to the system file manager. When another extension registers the same
type, choose Files in the opener or save it as the default for that type.
**Settings → General → Files** lets you add custom file types and change defaults.

On older Muxy versions, select Files under **Settings → General → Open Files
With** as before. The manifest keeps its legacy `patterns: ["*"]`, opener ID,
and tab type; the new `fileTypes` list is additional metadata that older Muxy
versions ignore. The editor continues using the same APIs and tab data.

## File icon themes

The palette button in the panel header, or **Files: Select File Icon Theme…**,
opens a menu of themes:

- **Minimal**: monochrome outline icons.
- **Material Icon Theme**: the full theme, compiled at build time from the
  `material-icon-theme` package, with per-file, per-folder, open-folder, and
  light-mode icons.
- Imported VS Code file icon themes. **Import VS Code Icon Theme (.vsix)…**
  takes a `.vsix` dropped from Finder (Muxy's web views have no file chooser)
  and reads it in the page, with no shell commands or new permissions. Every
  theme in the package is validated and previewed before it's saved to
  IndexedDB. Imports never run extension code.

The engine is in `src/shared/icon-themes/`:

| File | What it does |
| --- | --- |
| `zip.js` | Reads `.vsix` archives with `DecompressionStream`, with size limits |
| `compile.js` | Validates a theme and inlines its icons (SVG, raster images, font glyphs); unusable icons and mappings are dropped and reported |
| `resolve.js` | VS Code's matching rules: file names, path-qualified names such as `.github/workflows`, longest extension, language IDs, folder and open-folder names, and the `light` section |
| `store.js` | IndexedDB storage, shared by the panel and the importer |

`npm test` covers the engine. Set `ICON_VSIX_DIR` to a folder of `.vsix` files
to also check real packages.

## How it's put together

| Path | What it is |
| --- | --- |
| `src/panel/` | The Files panel: `model.js` (tree data), `virtual-list.js` (renders only on-screen rows), `git.js` (status decorations), `panel.js` (events, keyboard, mouse, drag and drop, file operations) |
| `src/editor/` | The editor tab: `main.js` starts the file read before CodeMirror finishes loading; viewers (Markdown, PDF, images, HTML, SVG) and heavy helpers load only when a file needs them |
| `src/shared/` | Code both pages use: paths, icons, preferences, and `editors.js`, the panel/editor/script handshake that keeps one tab per file |
| `scripts/` | Palette commands (`runScript`): Go to File (`quick-open.js`) and Find in Files, bundled by `copy-build-assets.mjs` |
| `dev/` | A mock `window.muxy` and benchmarks for running both pages in a browser — see `dev/README.md` |

Design rules that keep it fast:

- **The tree is virtualized.** Only rows in view exist in the DOM, so a tree with
  thousands of open rows scrolls and navigates like a small one.
- **File events are cheap.** `file.changed` paths are mapped to the one folder
  they touch; folders on screen are re-listed (and re-rendered only if the
  listing changed), collapsed ones are marked stale, and changes under ignored
  folders such as `node_modules` don't refresh git status.
- **Typing does no per-keystroke I/O.** No full-document copies, storage
  writes, or diffs run per key; the git gutter diff runs when typing pauses.
- **One tab per file.** Opening a file that is already open focuses its tab —
  from the tree, Go to File, Find in Files, or a terminal link.

## Tabs

Opening a file works like an IDE's preview tab. It replaces the file in the
editor tab you used last, as long as you haven't edited that file; its name
shows in *italics* while it can be replaced. Once you edit it (even if it saves
automatically), or double-click it in the file tree, the tab stays, and the
next file opens in a new tab. This applies to the file tree and to files opened
from terminal links. A file that is already open just focuses its tab.

To always open a new tab instead, turn off **Open files in the current tab
until edited** in the editor's settings (the gear in the editor toolbar).

Markdown files open in the mode you last picked with the **Preview / Edit**
toggle (or the `e` key), so working through several files in Edit mode doesn't
need a toggle per file. Switching to Edit to search or jump to a line doesn't
change it.

In Markdown **Edit** mode, click **Format Markdown** in the toolbar or press
**Shift+Option+F** (`⇧⌥F`, **Shift+Alt+F** on other platforms) to format the
document. Formatting uses Prettier for Markdown and MDX and wraps paragraphs
at a target width of **80 characters by default**. Change **Markdown line width**
in **Editor settings** (the gear in the toolbar) to choose a different width;
the preference is saved and shared across editor tabs. It takes effect the next
time you format. Formatting preserves explicit Markdown hard breaks, leaves
embedded languages unformatted, and follows the editor's auto-save setting.
Undo (`⌘Z` / `Ctrl+Z`) restores the content from before formatting in one step.

In the editor, **Option-click** (**Alt-click** on other platforms) to add a cursor
at each location you want to edit. Typing edits all cursors at once. **Option-drag**
selects a rectangle across lines.

## Keyboard (file tree)

Focus lands in the tree when the panel opens (or click any row), then:

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move between rows (`⇧` extends the selection) |
| `→` | Expand a folder, or move to its first child if already open |
| `←` | Collapse a folder, or move to its parent |
| `Page Up` / `Page Down`, `Home` / `End` | Jump a page, or to the first / last row |
| `Return` / `Space` | Open the file, or toggle the folder |
| `F2` | Rename |
| `⌫` / `⌘⌫` | Move to Trash |
| `Esc` | Reduce a multi-selection to one row |
| type a name | Jump to the next matching row |

`⌘`-click toggles a row in the selection and `⇧`-click selects a range. Drag
rows onto a folder to move them (hovering a closed folder opens it), or into a
terminal to paste their paths. Right-click for New File, New Folder, Rename,
Duplicate, Copy Path, Reveal in Finder, Open in Terminal, and Delete.
