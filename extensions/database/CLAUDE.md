# database

SQL database client extension for Muxy supporting SQLite, MySQL, MariaDB, and PostgreSQL.

## Stack

- NPM + Vite
- Tailwindcss v4
- React 19 (JSX, `@vitejs/plugin-react`)
- CodeMirror 6 for the SQL editor

## Architecture

- A pinned `connections` panel (`panel/connections.html` → `src/connections-panel.jsx`) renders `ConnectionsScreen` and lists saved connections. Clicking one emits `extension.database.open-connection`.
- `background.js` receives that event and opens (or focuses, if already open) a `workbench` tab for that connection — one tab per connection, tracked via `tab.created`/`tab.closed`.
- The `workbench` tab (`panel/index.html` → `src/main.jsx` → `src/app/workbench-app.jsx`) is always opened with `muxy.data.connectionId` and hosts the schema browser, data grid, SQL editor, and structure views.
- UI is React components (`src/**/*.jsx`); pure logic (drivers, SQL builders, parsing, storage, credentials, tunnels) stays framework-free under `src/lib/`. Workbench state lives in `src/workbench/session-context.jsx` (`SessionProvider`/`useSession`) over the mutable session object from `src/workbench/state.js`; shared UI primitives (`Icon`, `Modal`, `ContextMenu`, `EmptyState`) live in `src/ui/`.
- All database access goes through CLI clients via `muxy.exec`, one buffered call per operation. Every call uses the argument-vector form (never a shell string) so Muxy remembers consent per client binary; `src/lib/exec.js` is the only exec wrapper.
- Drivers in `src/lib/drivers/` share one interface; results are normalized in `src/lib/parse/result.js`.
- Passwords live in the macOS Keychain (`src/lib/credentials.js`) and are materialized at connect time into a `0600` credential file (`src/lib/cred-file.js`) that the CLIs read via `passfile`/`--defaults-extra-file`; connection metadata in `muxy.storage` (`src/lib/storage.js`).
- File writes (exports, credential files) go through `src/lib/secure-file.js` (`perl` argv) and clipboard through `src/lib/clipboard.js` (`osascript` argv) — no shell.
- SSH tunnels are self-backgrounding `ssh -f` processes managed by `src/lib/tunnel.js`.

## Building & editing

Install deps with `npm install`, then `npm run build` to produce `dist/`. After rebuilding, click "Reload" in the Muxy Extensions modal to pick up the changes.

## Guides

- Never use code comments. If you see any, remove them.
- Write less code, small components, re-usable code.
- Avoid large files.
- Don't patch symptoms and fix the root cause.
- Consult the `muxy-extension` skill in `.claude/skills/` before manifest or runtime changes.
