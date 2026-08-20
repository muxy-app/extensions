# Files

Muxy file explorer and editor extension built with vanilla JavaScript, Vite, Tailwind CSS, `muxy.files`, and `muxy.tabs`.

```bash
npm install
npm run build
```

The panel entrypoint is `src/main.js`; the editor tab entrypoint is `src/editor/main.js`. Build output is written to `dist/`; reload the extension in Muxy after rebuilding.

Select Files under Muxy Settings → Projects → Open Files With to route terminal file links into the editor tab.

## Photo editor

Open any raster image (`png`, `jpg`, `webp`, `gif`, `bmp`, `avif`) from the file
tree and switch the tab from **View** to **Edit** — or right-click the file and
pick **Edit Image…**, or run **Photo: Edit Image…** from the command palette.

| Tool | What it does |
| --- | --- |
| **Crop** | Drag a rectangle anywhere on the picture or pull the eight handles. Free-form or locked to 1:1, 4:3, 3:2, 16:9 or the original ratio, with a portrait/landscape swap. Exact width/height fields, rule-of-thirds guides, arrow-key nudging. `Enter` (or a double-click, or **Apply crop**) previews the result. |
| **Rotate** | Any angle, not just quarter turns — a −180°…180° slider at 0.1° steps, a typed value, ±0.1°/±1° buttons and 90° quick turns. Mirror horizontally or vertically. *Trim edges* crops to the largest rectangle that has no empty corners after a tilt. |
| **Resize** | Width/height in pixels with an aspect lock, percentage scaling, 25/50/75/100 % presets and "fit longest side to 512/1024/1920/2560". Downscaling runs in halving steps so big reductions stay smooth. |
| **Color** | Exposure, brightness, contrast, saturation, vibrance, temperature, tint, hue, gamma and sharpen, plus black & white and invert. Click a slider's label to reset it. |

Every edit is undoable — `⌘Z` / `⇧⌘Z`, or the arrows in the sidebar footer. A
whole slider drag counts as one step.

Save writes back over the original (after one confirmation) or, with **Save a
copy**, next to it as `name-edited.png`. The export format can stay as the
original or be switched to PNG / JPEG / WebP with a quality slider.

Preview and export share one render pipeline (`src/photo/pipeline.js`), so what
is on screen is what lands on disk: the preview runs on a downscaled copy of the
source, the export always on the full resolution one.

| Key | Action |
| --- | --- |
| `C` / `R` / `S` / `A` | Crop / Rotate / Resize / Color tool |
| `Enter` | Apply the crop |
| `[` / `]` | Rotate by one degree |
| `H` / `V` | Mirror horizontally / vertically |
| `+` / `-` / `0` | Zoom in / out / fit |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘S` | Save |

`muxy.files.write` is UTF-8 only, so the encoded bytes are handed over as base64
chunks that one fixed shell command reassembles (`src/lib/image-write.js`). Muxy
remembers exec consent per exact command string, so the prompt appears once.
This uses `files:write` and `commands:exec`, both already declared.

## Keyboard navigation

The file tree is fully operable from the keyboard. Focus lands in the tree
automatically when the panel opens (or click any row), then:

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move between visible rows |
| `→` | Expand a folder, or move to its first child if already open |
| `←` | Collapse a folder, or move to the parent folder |
| `Enter` / `Space` | Open the file, or toggle the folder |
| `Home` / `End` | Jump to the first / last row |
| `F2` | Rename the selected item |
| type a name | Type-ahead to the next matching entry |
