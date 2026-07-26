# git-workspace

Git extension for Muxy with multi-repo workspace support — fork of the official git extension. A workspace root folder is scanned for git repositories (max depth 3) and a repo switcher in the panel header (or the "Git Workspace: Switch Repository…" command) switches which repository the whole panel operates on. The selection is persisted per Muxy project in localStorage; the workspace root defaults to the parent folder of the active worktree.

## Stack

- NPM
- Tailwindcss
- Vanilla JavaScript

## Building & editing

Install deps with `npm install --ignore-scripts`, then `npm run build` to produce
the bundled files in `dist/`. After rebuilding, click "Reload" in the Muxy
Extensions modal to pick up the changes.

## Guides

- Never use code comments. if you see anywhere, remove
- Write less code, small components, re-usable code.
- Avoid large files
- Don't patch symptoms and fix the root cause
