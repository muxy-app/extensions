# Beads for Muxy

A Muxy extension that shows Beads issues from the active workspace in a pinned Kanban panel.

```bash
npm install
npm run build
```

Load `extensions/beads/` with Muxy's **Load Unpacked** flow. After rebuilding, click **Reload** in the Extensions modal.

## Behavior

- Reads `bd list --json --all --limit 0`.
- Uses `bd ready --json` only to add a `Ready` badge.
- Falls back to `issues.jsonl` or `.beads/issues.jsonl`.
- Shows built-in Beads statuses plus discovered custom statuses.
- Lets columns collapse and reorder locally without changing Beads data.
- Lets users choose an auto-update interval from Never to 5 minutes.

## Permissions

- `commands:exec` to run `bd`.
- `files:read` for JSONL fallback.
- `projects:read` and `worktrees:read` for active workspace context.
- `panels:write` for the panel and topbar toggle.
- `storage:read` and `storage:write` for local column order.
