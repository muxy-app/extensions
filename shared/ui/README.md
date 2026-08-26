# @muxy/ui — shared UI for Muxy extensions

A small, framework-free UI package that gives every extension in this repo the
native Muxy look by default: the documented sizing scale as CSS tokens, ~30 CSS
primitives built exclusively on the official `--muxy-*` theme variables, and a
few tiny DOM helpers. Vanilla JS + plain CSS, zero dependencies, no build step
of its own — Vite bundles it into each consumer's `dist/` at build time.

It is deliberately **not a framework**: tokens, classes, and helpers you can
compose with your own CSS, override per extension (every token is a CSS
variable), or remove entirely by deleting the import.

## Consuming it

Add a path alias to your extension's `vite.config.js`:

```js
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@muxy/ui": resolve(__dirname, "../../shared/ui"),
    },
  },
});
```

Then in your entry module:

```js
import "@muxy/ui/ui.css";
import { icon, cls, escapeHtml, clamp, middleTruncate } from "@muxy/ui";
```

`ui.css` pulls in `tokens.css` automatically. To use only the tokens with your
own component CSS, import `@muxy/ui/tokens.css` instead.

The alias points at source inside the monorepo, so the bundled output is fully
self-contained — nothing changes about packaging, signing, or what ships in
`dist/`. A shared change reaches an installed extension the next time that
extension is rebuilt and republished with a version bump (published versions
are immutable).

> **Sparse checkouts:** if you cloned with `git sparse-checkout`, add `shared`
> to your checkout set alongside your extension and `scripts`.

## Tokens (`tokens.css`)

The documented Muxy scale, declared once on `:root`:

| Token | Values |
| --- | --- |
| `--s1` … `--s10` | Spacing scale: 2 · 4 · 6 · 8 · 10 · 12 · 16 · 20 · 24 · 32 px |
| `--font-caption/footnote/body/emphasis/title/heading` | 10 / 11 / 12 / 13 / 14 / 16 px |
| `--icon-sm` / `--icon` | 12 / 14 px glyphs |
| `--control` / `--button-height` / `--row-height` | 24 / 28 / 34 px |
| `--radius-badge` / `--radius` / `--radius-card` / `--radius-sheet` | 4 / 6 / 8 / 10 px |
| `--font-ui` / `--font-mono` | System UI stack / `"SF Mono", Menlo, monospace` |

Colors are **not** defined here — every primitive uses the `--muxy-*` variables
Muxy injects, so everything tracks the live theme with no light/dark branching.
Override any token per extension by redefining it after the import.

## Primitives (`ui.css`)

All classes are `mx-`-prefixed so they never collide with your own.

| Class | Use |
| --- | --- |
| `.mx-topbar`, `.mx-topbar-title` | Tab topbar matching native tabs (`--muxy-topbar-height`, `content-box`) |
| `.mx-toolbar`, `.mx-spacer` | Horizontal control strip; flexible gap filler |
| `.mx-btn` (+ `-primary`, `-ghost`, `-danger`) | 28px text button |
| `.mx-icon-btn` (+ `.is-active`) | Borderless 24×24 icon button |
| `.mx-input`, `.mx-select`, `.mx-textarea` | Form controls with accent focus |
| `.mx-card` | Surface card, radius 8 |
| `.mx-badge` (+ `-accent`, `-count`) | Small chip; accent variant; mono count |
| `.mx-spinner` (+ `-lg`) | Loading spinner (respects reduced motion) |
| `.mx-progress` > `.mx-progress-bar` | Progress track + accent fill (set `width` on the bar) |
| `.mx-switch` | Toggle, on `<input type="checkbox">` |
| `.mx-segmented` > `.mx-segmented-btn` (+ `.is-active`) | Segmented control |
| `.mx-menu`, `.mx-menu-item` (+ `.is-danger`), `.mx-menu-separator` | Floating/context menu (position it yourself) |
| `.mx-list`, `.mx-row` (+ `.is-selected`), `.mx-row-sub` | Panel list rows, 10px side padding |
| `.mx-section-label` | 11px uppercase section header |
| `.mx-empty`, `.mx-empty-title`, `.mx-empty-copy` | Centered empty state |
| `.mx-divider`, `.mx-kbd`, `.mx-link` | 1px rule; keyboard hint; accent link |
| `.mx-md` | Markdown preview container (headings, code, tables, quotes) |

Open `preview.html` in a browser to see every primitive rendered against
sample light and dark theme values.

## Helpers (`index.js`)

- `escapeHtml(value)` — escape `& < > " '` for safe interpolation into HTML.
- `clamp(value, min, max)`.
- `cls(...parts)` — join class names from strings, arrays, and
  `{ name: condition }` objects.
- `middleTruncate(value, max)` — `"very/long/path…end/file.txt"`-style
  truncation for paths and hashes.
- `icon(paths, { size = 14, strokeWidth = 1.5, className })` — build an inline
  SVG element from one or more Lucide-style path `d` strings, with the native
  stroke contract (1.5px, round caps/joins, `currentColor`) applied. Copy the
  `d` values from [lucide.dev](https://lucide.dev); no icon font or dependency
  ships with the package.

## What it deliberately does not include

Muxy already provides the overlay surfaces natively — use those instead of
rebuilding them in a webview:

- List picker / search overlay → `muxy.modal.open`
- Confirm / alert / prompt / folder picker → `muxy.dialog.*`
- Notifications → `muxy.toast` / `muxy.notifications`

## Evolving the package

- **Additive first.** New primitives, variants, and tokens must not change the
  rendering of existing classes; existing extensions are unaffected until they
  rebuild.
- **Breaking changes** (renames, DOM-contract changes) update every consumer in
  the same PR — `grep -r "mx-<name>" extensions/` finds them all.
- `ui.test.mjs` is the package's contract check, run by `npm test` and CI: every
  documented primitive and token exists, no hardcoded hex colors, and only the
  officially injected `--muxy-*` variables are referenced. Extend it when you
  add a primitive.
- A PR that only touches `shared/` triggers a full build + validate of every
  extension in CI, so consumer breaks surface before merge.
