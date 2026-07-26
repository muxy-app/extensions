# commands

Pinned command launcher for Muxy — run claude/codex and custom commands in a new terminal.

## Stack

- NPM + Vite
- Vanilla JavaScript, no framework

## Architecture

- One topbar item → `openPopover` → `popover/` lists the user's commands; clicking
  one calls `muxy.tabs.open({ kind: 'terminal', command, directory? })`.
- `tab/` is the settings surface (extensionWebView tabType `settings`) for CRUD.
- Commands persist in `localStorage` (`src/lib/store.js`); popover and tab share
  the same origin, so the `storage` event keeps the popover in sync live.
- Icons (`src/lib/icons.js`) are inline lucide-style SVGs keyed by name, plus
  emoji passthrough. Topbar manifest icon is an SF Symbol (native render only).

## Building & editing

`npm install --ignore-scripts`, then `npm run build` to emit `dist/`. After
rebuilding, click **Reload** in the Muxy Extensions modal.

## Guides

- No code comments.
- Small, reusable functions; avoid large files.
- Every color is a `var(--muxy-…)`; sizes come from the scale in `global.css`.
