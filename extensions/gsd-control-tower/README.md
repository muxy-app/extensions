# GSD Control Tower for Muxy

> See what every GSD workstream is doing, which agent needs you, and where to go next — without leaving Muxy.

GSD Control Tower is a **read-first** [Muxy](https://muxy.app/docs/extensions/overview) extension that combines project planning state from
[GSD](https://github.com/open-gsd/gsd-core) artifacts (`.planning/`) with live AI-agent activity reported by **Muxy itself**.
Planning state comes from your files and works with any GSD workflow. The live agent overlay, however, only sees agents that
**run inside Muxy** (Claude Code, Codex, Droid, Grok, OpenCode, Pi, Cursor, Kiro, Antigravity, Xal panes) — Muxy reports their
lifecycle via provider hooks. Agents running in an external terminal (a plain Codex CLI, Claude Code in Terminal.app, harness
processes) are invisible to Muxy's `agents` APIs and are never invented by this panel.

## What it tells you

- The panel **opens inside the project you're currently in** (Preferences → Open on active project), showing its milestone progress,
  next action, and a **phase pipeline**: every phase with its rollup status (Complete / In progress / Underway / Queued) and
  **stage chips for what has happened within it** — discuss · research · ui spec · patterns · plan · execute n/m · verify ✓/✗ · review · security · validation. Click a phase for its goal and details.
- Which **Muxy-hosted** agent is **working, waiting for you**, or idle — per worktree, from Muxy's agent APIs. The Agent activity block
  says so explicitly when empty: external-terminal agents (Codex CLI outside Muxy, DeepSeek Harness, Terminal.app sessions) don't report through Muxy.
- What looks **blocked**, **stale** (no observed change within your threshold), or **ready** (an explicit next action recorded in your artifacts).
- **Blockers vs concerns:** notes under `Blockers/Concerns` are shown as *concerns* and never block on their own; a workstream only reads
  Blocked when STATE.md's own status says blocked or a phase verification failed. Future-tense notes ("needs a Windows machine later") stay visible without hijacking the attention queue.
- A ranked **attention queue** so the thing that needs you is always at the top.
- **Non-GSD projects stay out of the list by default** (Preferences → Show non-GSD projects). They still reach *Needs attention* when an agent reports waiting/working — runtime attention is provider business, not GSD business.

## Surfaces

| Surface | Purpose |
| --- | --- |
| **Control Tower panel** (right dock) | Attention queue, all workstreams, per-workstream detail, search + filters, diagnostics, preferences |
| **Status bar item** | Attention count with icon swap; click toggles the panel |
| **Background script** | Session-scoped event hub that updates a hydrated status-bar baseline while the panel is hidden |

Palette commands (`⌘⇧G` toggles the panel): toggle panel · refresh all · toggle diagnostics · reveal top attention item.

## Control states

Priority order: `waiting > blocked > unknown > stale > ready > working > idle`.

| State | Meaning |
| --- | --- |
| Waiting | Muxy reports an agent waiting for attention (never inferred from silence) |
| Blocked | GSD artifacts explicitly say blocked, or a phase verification failed — never from concern notes |
| Unknown | `.planning/` exists but required artifacts are missing/unreadable/inconsistent |
| Stale | Work still open, nobody driving, no observed change within your threshold |
| Ready | Artifacts record a clear next action and no agent is active |
| Working | Muxy reports an agent actively working |
| Idle | Recognized GSD state with nothing demanding attention |

Derived states (`blocked`, `stale`, `ready`) always show their reason and evidence. Runtime states come only from Muxy.

## Permissions & privacy

Read-first MVP. No command execution, no file writes, no Git writes, no terminal reading, no transcripts, no notifications, no network,
no telemetry — nothing leaves your machine.

The extension reads only recognized relative paths under `.planning/` through Muxy's brokered file API. Diagnostics are bounded and stay in Muxy-managed extension storage. They contain capability results, artifact-relative paths, and error messages; they do not intentionally capture file bodies, terminal output, transcripts, credentials, or telemetry. Screenshots and release bundles are scanned for private paths and credential patterns before submission.

| Permission | Why |
| --- | --- |
| `projects:read` / `worktrees:read` | List the projects and worktrees you already added to Muxy |
| `agents:read` | `agents.list()` hydration + `agent.status` events |
| `files:read` | Read recognized `.planning/` artifacts only |
| `git:read` | Branch, last-commit date (staleness evidence), dirty-file count |
| `storage:read/write` | Your filters, thresholds, included-project choices, bounded diagnostics |
| `panels:write` | Panel open/toggle + status-bar updates |
| `projects:write` + `worktrees:write` | **Only** for the explicit "Open context" action (switches Muxy's active project/worktree) |

## Honest limitations

- **Planning state is read per project's active worktree.** Muxy sandboxes file reads to each project's active worktree root, so other
  worktrees of the same project show live agent/git overlay plus an explicit note instead of fabricated planning state.
- **Cross-project freshness is event-driven where Muxy allows it.** `file.changed` covers the active project/worktree; other projects
  refresh on panel open, manual refresh, and project/worktree changes. Rows show their last refresh.
- **Provider capabilities differ.** Providers whose CLIs expose no "waiting" hook (Pi, Cursor, Kiro, Antigravity, Xal) are labeled as such;
  the extension never treats silence as waiting.
- **Agent activity is Muxy-scoped.** `agent.status` / `agents.list()` only cover agents hosted in Muxy panes. Work done by agents in
  external terminals — including Codex CLI outside Muxy or any harness-driven process — never appears in the Agent activity block or in
  Waiting/Working states; GSD artifact state (phases, plans, verification, staleness) is unaffected.
- Agent state is a **worktree-level aggregate** (Muxy semantics), not a per-process inventory.
- **Lifecycle scope is session-local.** After Muxy restarts, the background indicator remains neutral until the panel publishes a fresh inventory snapshot. It does not persist derived attention that may be stale.
- **SSH workspaces are not qualified for 0.1.0.** Local projects are the supported deployment shape. Native remote qualification is tracked in [OPEN_ISSUES.md](OPEN_ISSUES.md).

## Requirements

- [Muxy](https://muxy.app/) on macOS. Version 0.1.0 was tested with Muxy 1.5.0 (945).
- Projects tracked with [GSD](https://github.com/open-gsd/gsd-core) — i.e. a `.planning/` directory. Non-GSD projects are hidden from
  the list by default and only surface runtime attention.
- Live agent states additionally require agents hosted in Muxy panes (see limitations below).

## Installation

**From the Muxy marketplace (recommended):** Open Muxy → Extensions → Marketplace, find **GSD Control Tower**, and choose **Install**. Muxy owns marketplace updates and permission prompts.

**From source:**

```bash
npm ci && npm run build
```

Then in Muxy: Extensions modal → **Load Unpacked** pointing at this folder's `dist/`, and **Reload** after rebuilds.

## Troubleshooting

- **Panel shows "permission denied"** — open Diagnostics (⌘⇧G → info icon); each capability shows whether it worked or was denied.
  Re-grant the listed permission (e.g. `files:read`) when Muxy prompts, then hit refresh.
- **A project shows "Planning state unreadable"** — the Diagnostics error log names the exact artifact; the parsers are tolerant, but a
  truncated `.planning/STATE.md` will surface there.
- **Agent activity is empty** — that block only reflects agents running inside Muxy panes. External terminal sessions never report
  through Muxy; this is expected, not a bug.
- **Stale everywhere** — staleness is honest: incomplete work with no observed change inside your threshold (default 45 min).
  Raise it in Preferences if you work in long quiet stretches.
- **A project is marked project-scoped** — Muxy denied or could not provide its worktree inventory. Diagnostics names the affected API result; the extension does not present the fallback row as a confirmed worktree.

## Uninstalling

Disable or uninstall GSD Control Tower from Muxy's Extensions screen. This removes the panel, commands, status item, event subscriptions, and Muxy-managed extension preferences. The extension never writes project files, Git state, commands, notifications, or external services, so there is no project-side cleanup.

## Development

```bash
npm install
npm test          # node:test suite over parsers, precedence, reducer, selectors, prefs, navigation
npm run build     # vite build → dist/ (+ manifest copy + structural/schema validation)
npm run validate  # frozen manifest/assets, import graph, secrets, audit, deterministic clean copies
```

Then in Muxy: Extensions modal → **Load Unpacked** (dev) pointing at this folder, build, and **Reload**.
Muxy loads the built `dist/`; the build script copies `package.json` into it because only `dist/` ships.

### Project layout

```
panel/index.html          panel entry
src/main.js               bootstrap
src/panel/app.js          UI controller + views (list/detail/diagnostics/settings)
src/background/main.js    event hub → status bar
src/core/                 pure domain: types, frontmatter, GSD parsers, status derivation, reducer, selectors, navigation
src/host/                 window.muxy bridge wrappers (feature-detecting) + storage-backed prefs
test/fixtures/            committed GSD artifact shapes (active, complete-with-blockers, broken)
scripts/                  copy-manifest.mjs, validate-dist.mjs (permission policy + JSON-Schema check)
```

### Parser contract

Versioned tolerant adapters (`gsd-parser/1.0`) support `gsd_state_version: 1.0` and captured classic plus milestone-era GSD shapes: `STATE.md` frontmatter + Current Position +
Blockers-vs-Concerns classification (bullets block only when status explicitly says blocked) + freshest-timestamp activity,
`ROADMAP.md` checklist/details (integer and decimal phases), per-phase directories with a full stage pipeline
(discuss/research/ui/patterns → plan/execute queues → verification/review/security/validation), `PROJECT.md`, `config.json`,
`HANDOFF.json`, `.continue-here.md` (root or phase dir), current-phase `VERIFICATION.md`, milestone-era layouts (`MILESTONES.md`,
`.planning/milestones/vX.Y-*`). Unknown headings/files are tolerated; every displayed claim cites its source path; problems surface
as warnings/errors on the snapshot — never fabricated progress, and completion is never inferred from agent idleness.
Evidence timestamps read from artifact content are marked dated; read-time stamps never feed staleness math.

Release policy and history: [RELEASING.md](RELEASING.md) · [CHANGELOG.md](CHANGELOG.md).
