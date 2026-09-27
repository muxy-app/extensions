# Agentic Sidebar

A minimal, agent-focused sidebar for Muxy. Navigate projects and their Git
worktrees by what your AI agents are doing, with live status.

- Replaces Muxy's sidebar (Settings → Appearance → Active sidebar), or opens as
  a pinned right panel with **Toggle Agentic Sidebar** (`Cmd+Shift+A`).
- Shows each project's branch, uncommitted changes, and ahead/behind counts.
- Expands a project into its worktrees and switches projects or worktrees.
- A status dot per project and worktree shows its most active agent: working,
  waiting for you, or idle.
- Filters projects by name.

## Permissions

- `projects:read`, `projects:write` — list projects and switch between them.
- `worktrees:read`, `worktrees:write` — list and switch worktrees.
- `agents:read` — show agent status and receive `agent.status` events.
- `git:read` — branch, change, and worktree details.
- `files:read` — receive `file.changed` to refresh a project's Git status.
- `panels:write` — the pinned panel and its toggle.

## Build

```bash
npm install
npm run build
```
