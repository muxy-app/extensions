# Muxy Todos

A per-project todo list for [Muxy](https://muxy.app). Every Muxy project keeps its own tasks, so switching projects always shows the right list.

## Features

- **Per-project data** — each project's tasks are stored under its own namespace (`todos:<projectID>`), persisted across restarts.
- **Drag to reorder** — grab any row to rearrange; the order is saved. Incomplete tasks stay on top, completed ones sink to the bottom.
- **Priorities** — right-click a row to set a priority (Highest / High / Medium / Low / Lowest), shown as a colored circle next to the text.
- **Fast entry** — type and press Enter (or click **Add**) to create a task; toggle the checkbox to complete, hover the row for delete.
- **Clear completed** — one-click cleanup from the panel header (with confirmation).
- **Theme native** — follows the app's light/dark themes and accent color; no hardcoded chrome colors.

## Build

```bash
npm install
npm run build
```

After rebuilding, click **Reload** in the Muxy Extensions modal to pick up changes (`npm run dev` runs Vite's dev server for fast iteration).

## Layout

- `panel/index.html` — panel entry, builds to `dist/`.
- `scripts/copy-manifest.mjs` — copies `package.json` into `dist/` after the Vite build, so the published `dist/` is a self-contained, installable folder. `build` runs it.
- `src/main.js` — mounts the panel onto `#root`.
- `src/panel/app.js` — the panel UI, rendered with the `h()` DOM helper.
- `src/lib/` — tiny `dom` and `icon` helpers.
- `src/styles/global.css` — Tailwind, with opaque component fills and contrast colors mapped to the app's `--muxy-*` tokens so utilities like `bg-surface`, `bg-primary`, and `text-primary-foreground` follow the active theme.

## Permissions

`panels:write` · `projects:read` · `storage:read` · `storage:write` — the minimum needed to render the panel, know the active project, and persist tasks.

See the [extension docs](https://github.com/muxy-app/muxy/tree/main/docs/extensions).
