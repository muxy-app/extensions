# Focus Timer

A pomodoro in the status bar, and an automatic, all-local ledger of where your
hours actually went — per project, per worktree, **you vs. your agents**.

Start a 25-minute focus block with one keystroke (⌘⌃T); meanwhile the
extension quietly attributes active time to whichever project you're in, and
the report tab draws the chart only Muxy can draw: your focused time next to
your agents' working time, per project, per day.

**No accounts, no sync, and no network access of any kind.** The manifest
requests no `http` permission, and every shell command it runs is quoted
verbatim below — two local reads and one local write, all on this Mac.

## What it does

- **Pomodoro** — focus/break/long-break cycle, status-bar countdown,
  phase-end notifications, palette + ⌘⌃T control, per-day session dots.
- **Automatic time tracking** — per-project and per-worktree active time,
  attributed from workspace events and gated by real idle detection — not
  "Muxy was open".
- **Agent time** — seconds each project's agents spent `working`, tracked as
  a separate series. The you-vs-agents comparison is the whole point.
- **Report tab** — day/week/month views, stacked per-day bars by project,
  a project table with you/agent/pomos columns and worktree drill-down,
  CSV export to the clipboard.
- **Honest degraded modes** — when idle detection is unavailable (consent
  denied, remote SSH workspace), tracking continues from workspace events
  alone and the data is labeled approximate (`~`).
- **Privacy affordances** — one-click pause, optional working-hours fence,
  all data local, 400-day retention, one-click delete.

## The three shell commands (quoted verbatim)

Muxy asks for consent per exact command string; these are frozen and only
change with a version bump noted in the release notes.

1. **Idle/frontmost probe** — every 30 s, read-only:

   ```sh
   ioreg -c IOHIDSystem -d 4 | awk '/HIDIdleTime/ {print $NF; exit}'; echo @@; lsappinfo info -only bundleid $(lsappinfo front)
   ```

   `HIDIdleTime` is the system's input-idle time; `lsappinfo` (a macOS
   built-in, no TCC prompt) reports which app is frontmost. Deny it and the
   extension keeps working in the labeled approximate mode.

2. **State read** (at launch) and **state write** (once a minute, only when
   something changed):

   ```sh
   lsappinfo front >/dev/null 2>&1 && echo "@@LOCAL@@"; cat "$HOME/Library/Application Support/muxy-focus-timer/state.json" 2>/dev/null; exit 0
   ```

   ```sh
   lsappinfo front >/dev/null 2>&1 || exit 90; FT="$HOME/Library/Application Support/muxy-focus-timer"; mkdir -p "$FT" && cat > "$FT/state.json.tmp" && mv -f "$FT/state.json.tmp" "$FT/state.json"
   ```

   Why a file? Muxy background scripts can't use `muxy.storage` yet, and a
   time tracker must survive quitting Muxy without ever opening a panel. The
   file is plain JSON at
   `~/Library/Application Support/muxy-focus-timer/state.json` — yours to
   read, export, or delete. The `lsappinfo` guard makes both commands refuse
   to touch the filesystem of a remote (SSH) workspace host. Deny the write
   and the extension falls back to popover-mediated storage: history then
   persists only while the popover or report is open, capped at 60 days.

## Permissions, and why

| Permission | Why |
| --- | --- |
| `commands:exec` | The three local commands above — nothing else. Works without it in a labeled approximate mode. |
| `agents:read` | The agent-time series (`agent.status` subscription) and hydrating agent state when a panel opens. |
| `projects:read`, `worktrees:read` | The popover/report resolve project/worktree IDs to names, colors and branches. |
| `notifications:write` | Pomodoro phase-end notifications and the one-time setup note. |
| `panels:write` | Status-bar text/icon updates and popover resizing. |
| `tabs:write` | The "Open report" command/button. |
| `storage:read`, `storage:write` | Webview-side config cache and the fallback mirror when the state-file write is denied. |

There is no network permission in the manifest, and `muxy.http` is never
called.

## The philosophy of the idle threshold

Watching a long build with your hands off the keyboard counts as idle after
120 s. That's the design working — it's not focused work. The threshold is
configurable in the popover, and "count time in: whole machine" mode is there
for people whose editor/browser work belongs to the project too.

## Degraded modes, honestly

- **Remote (SSH) workspaces:** shell commands run on the remote host, where
  the probe has no `ioreg` — tracking automatically degrades to event-only
  and recovers when you're back on a local workspace. State-file writes are
  held (never sent to the remote host) until back local. A Linux probe
  variant is a v2 candidate.
- **Consent denied:** tracking continues from workspace events, assumed
  active for at most 10 minutes after the last event (configurable). Totals
  are marked `~` in the status bar and report; degraded days get a dotted
  marker. The probe is retried at most every 10 minutes — *Deny & remember*
  stops it entirely until you revisit Settings → Extensions → Permissions.

## Pairs well with

`ai-usage` tracks tokens and cost; Focus Timer tracks time. Together they
answer the best question in the building: *cost per hour of agent time*.
