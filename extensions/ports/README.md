# Ports

A [Muxy](https://muxy.app) extension that shows all TCP listening ports on your machine, grouped by Muxy project.

## Features

- **Live port list** — scans every 5 seconds via `lsof`, no manual refresh needed
- **Project grouping** — ports are grouped by the Muxy project whose directory contains the process's working directory
- **App only filter** — hide ports not belonging to any Muxy project
- **Open in browser** — click a port number to open `http://localhost:<port>`
- **Stop processes** — kill individual ports, a whole project group, or all visible ports at once
- **Status bar & topbar** — quick toggle via `⌘⇧P` or the antenna icon

## How it works

A background worker runs `lsof -iTCP -sTCP:LISTEN` every 5 s and resolves each process's working directory with a second `lsof -d cwd` call. Results are broadcast to the panel via extension events — the panel never executes shell commands itself, so the `lsof` consent prompt appears only once (at load time) and never steals focus from the UI.

## Permissions

- `commands:exec` — runs `lsof`, `kill`, and `open`
- `panels:write` — registers the Ports panel
- `projects:read` — reads your Muxy project list for grouping

## Development

```bash
npm install
npm run build   # or: npm run dev
```

After rebuilding, click **Reload** in the Muxy Extensions modal to pick up changes.
