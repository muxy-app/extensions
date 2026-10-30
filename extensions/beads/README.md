# Beads for Muxy

A Muxy extension that shows Beads issues from the active workspace as either a pinned panel or a full workspace tab.

```bash
npm install
npm run build
```

Load `extensions/beads/` with Muxy's **Load Unpacked** flow. After rebuilding, click **Reload** in the Extensions modal.

## Behavior

- Reads `bd list --json --all --limit 0`.
- Uses `bd ready --json` only to add a `Ready` badge.
- On Beads 1.3.0+ with the events journal enabled, checks `bd events tail --since <seq> --json` on each auto-refresh tick and skips full reads and redraws when nothing changed.
- Falls back to `issues.jsonl` or `.beads/issues.jsonl`.
- Shows built-in Beads statuses plus discovered custom statuses.
- Offers three saved views: a Kanban Board, a Dependency Graph, and a Project Health dashboard.
- Reads the `dependencies` edges from `bd list --json` to draw the blocker graph, trace an issue's chain, and surface bottlenecks, blocked work, and stale issues.
- Shows every issue as a graph node, including issues without dependency links.
- Restores the last successful snapshot for each worktree immediately, then refreshes it in the background.
- Opens as a full workspace tab from **Beads: Open Workspace Tab** in the command palette.
- Lets columns collapse and reorder locally without changing Beads data.
- Persists the selected view, column order, and auto-update interval.

## Journal-aware refresh

To reduce polling work with Beads 1.3.0 or later, enable the journal in each workspace:

```bash
bd config set events-journal true
```

This is opt-in. The extension never changes your Beads configuration. Enable it for every writer, including agents, so their changes are recorded.

The extension takes a full snapshot on opening, then uses the journal as a change detector at the selected auto-refresh interval (15 seconds by default). When records arrive, it reloads the issue list and ready work rather than replaying snapshots that omit dependency and comment details. Older Beads versions, disabled or unavailable journals, and malformed or incomplete responses fall back to full reads. A pruned checkpoint triggers a fresh snapshot before resuming from the journal head.

Checkpoints stay in memory and are reset when switching projects, worktrees, or branches. **Refresh Beads** always takes a full snapshot and resets the checkpoint. While auto-refresh is enabled, a full snapshot is also taken at least every five minutes (on the next tick) to pick up changes the journal does not cover, such as `bd dolt pull`, direct library writes, or journal resets. After a sync, use **Refresh Beads** to see those changes immediately. Selecting **Never** disables automatic refresh, including these periodic full reads.

No `bd serve` process, Dolt server, or HTTP connection is required; the one-shot CLI approach also works in embedded and remote workspaces.

## Permissions

- `commands:exec` to run `bd`.
- `files:read` for JSONL fallback.
- `projects:read` and `worktrees:read` for active workspace context.
- `panels:write` for the panel and topbar toggle.
- `tabs:write` for opening the full Beads workspace tab.
- `storage:read` and `storage:write` for workspace snapshots, saved view, column order, and refresh preferences.
