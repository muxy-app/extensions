# RESEARCH: Muxy AI Session History — CLI capabilities, Copilot titles, packaging, icons

> ⚠️ **SUPERSEDED** — All `scanner.py` / `manage.py` citations in this document refer to the **removed Python back-end** (deleted as part of the pure-JS host-fs migration). The on-disk formats described are still accurate, but the implementation now lives in `src/lib/sessions/scan/` (JS scanners) and `src/lib/sessions/manage/` (JS manage). References to Python line numbers are kept as historical context only.

> **Errata / authority:** For **Copilot on-disk layout, title chain, and rename**, prefer [04-copilot-session-identity.md](./04-copilot-session-identity.md) (local `data.db` + `session-state` + `workspace.yaml` + `session-store.db` probes). Sections below that say Copilot schema is fully unknown or only `meta.json` are incomplete. For **which sessions are CLI-resumable** (`No session, task, or name matched`), prefer [06-copilot-resume-mismatch.md](./06-copilot-resume-mismatch.md) — directory existence alone is insufficient; need non-empty `events.jsonl` and/or `turns`. For **archive product choice**, locked plan is Muxy-only for all CLIs (including Codex)—see [01-implementation-plan.md](./01-implementation-plan.md).

## 1. Per-CLI Session Storage & Management Capabilities

### 1.1 Storage Paths and Formats

#### Grok CLI

| Item | Value |
|------|-------|
| Storage root | `~/.grok/sessions/<url-encoded-cwd>/<uuid>/` |
| Title file | `summary.json` |
| Format | JSON object |
| Title fields (priority order) | `generated_title` → `session_summary` → `agent_name` |
| Session ID field | `info.id` (falls back to directory name) |
| Timestamp fields | `updated_at`, `last_active_at` (ISO-8601) |
| Branch field | None observed in summary; not stored by Grok |
| Env override | None documented |

**Citation:** `muxy-ai-session-history:src/lib/sessions/scanner.py:75-115` (`list_grok`).  
The CWD is URL-percent-encoded (`urllib.parse.quote`) to form the directory name — e.g. `/Users/alice/proj` → `%2FUsers%2Falice%2Fproj`.

---

#### Claude Code

| Item | Value |
|------|-------|
| Storage root | `~/.claude/projects/<slugified-cwd>/` |
| Session file | `<uuid>.jsonl` (one file per session) |
| Format | JSONL — one JSON object per line (events log) |
| Title extraction | Scan first 200 lines for records with `type: "custom-title"` → `title`/`customTitle`; then `type: "ai-title"` → `title`/`aiTitle`; then `type: "summary"` → `summary`; fallback to first `type: "user"` message content |
| CWD field | `cwd` key present in records — used to filter across project dirs |
| Branch field | `gitBranch` key in records |
| Env override | `CLAUDE_CONFIG_DIR` (overrides `~/.claude`) |

**Citations:**  
- `muxy-ai-session-history:src/lib/sessions/scanner.py:117-188` (`claude_title_from_jsonl`, `list_claude`).  
- Official docs: `https://code.claude.com/docs/en/settings` — confirms `~/.claude/` as user-scope config root.  
- Official CLI reference: `claude --resume <id>` and `claude -r "<session>"` (also by name). Source: `https://code.claude.com/docs/en/cli-reference`.

**Known limitation:** There is **no stable `title` field in the JSONL schema** exposed by Claude's CLI — the `custom-title`/`ai-title` events are internal event types. Any future format change would break title extraction silently. The slug for the project directory (`slugify`) replaces every non-alphanumeric character with `-`, so paths with different special characters can collide.

---

#### OpenAI Codex CLI

| Item | Value |
|------|-------|
| Primary storage | `~/.codex/state_<N>.sqlite` (highest `N` wins) |
| Table | `threads` |
| Required columns | `id`, `rollout_path`, `source`, `cwd`, `archived` |
| Title columns (optional) | `title`, `first_user_message` |
| Branch column (optional) | `git_branch` |
| Timestamp columns | `updated_at_ms` (preferred) or `updated_at` |
| Archived column | `archived` INTEGER (0/1) |
| Source filter | `source IN ('cli', 'vscode')` |
| Fallback (no DB) | JSONL files at `~/.codex/sessions/…/rollout-<timestamp>-<uuid>.jsonl[.zst]` |
| Fallback title | `session_meta` record → `payload.id`, `payload.cwd`, `payload.git.branch`; no title in JSONL |
| Env override | `CODEX_HOME` |

**Citations:**  
- `muxy-ai-session-history:src/lib/sessions/scanner.py:196-275` (`list_codex_db`, `list_codex_files`).  
- `muxy-ai-session-history:src/lib/sessions/manage.py:69-108` (`rename_codex`), `manage.py:177-211` (`archive_codex`).  
- GitHub source: `https://github.com/openai/codex` (README confirms `~/.codex` home; SQLite state store is an implementation detail not formally documented externally).

**Known limitations:**
- The `title` column may be absent in older DB schemas; scanner falls back to `first_user_message`.
- Archived sessions are **excluded** from the scanner query (`WHERE archived = 0`), meaning once archived via `archive_codex`, a session disappears from the list entirely and cannot be unarchived through this extension — a known bug (see §5).
- JSONL fallback yields `(untitled)` — no title is stored in the session file.

---

#### GitHub Copilot CLI

| Item | Value |
|------|-------|
| Likely storage root | `~/.copilot/` |
| DB candidate | `~/.copilot/session-store.db` (SQLite) — **schema not publicly documented** |
| Directory candidate | `~/.copilot/session-state/<id>/` |
| Directory metadata | `meta.json` (fields `name`, `title` — not confirmed) |
| Workspace match | `workspace.yaml` in session directory |
| Env override | `COPILOT_HOME` |
| Resume flag | `copilot --resume=<id>` |

**⚠️ Important:** The GitHub Copilot CLI **does not publish a documented session storage schema**. The paths above are inferred from the scanner's defensive probe logic and from the Muxy Copilot provider source. There is no official GitHub Copilot CLI docs page at `docs.github.com/en/copilot/using-github-copilot/coding-agent/resuming-a-copilot-coding-session-in-the-terminal` (returns 404 as of 2026-08-06).

**Citations:**  
- `muxy-ai-session-history:src/lib/sessions/scanner.py:277-361` (`list_copilot`) — probes multiple table names (`sessions`, `session`, `session_docs`, `chronicle`) and multiple column names (`id`, `session_id`, `sessionId`; `title`, `name`, `summary`; `cwd`, `workspace`, `workspace_path`).  
- `muxy/Muxy/Services/Providers/CopilotProvider.swift:1-10` — confirms `id = "copilot"`, `iconName = "copilot"`, `executableNames = ["copilot"]`, hook file at `~/.copilot/hooks/muxy-notify.json`.

---

#### Cursor Agent CLI

| Item | Value |
|------|-------|
| Storage root | `~/.cursor/chats/<MD5(cwd)>/` |
| Session directory | `<id>/` |
| Metadata file | `meta.json` |
| Title fields | `title`, `name` |
| Timestamp fields | `updatedAtMs`, `updatedAt`, `updated_at` |
| Branch field | `branch` |
| Env override | None |
| Resume flag | `cursor-agent --resume <id>` |

**Citations:**  
- `muxy-ai-session-history:src/lib/sessions/scanner.py:364-397` (`list_cursor`) — CWD hashed with `hashlib.md5`.  
- `muxy-ai-session-history:src/lib/sessions/manage.py:111-157` (`rename_cursor`, `delete_cursor`).  
- `muxy/Muxy/Services/Providers/CursorProvider.swift:1-10` — confirms `id = "cursor"`, `iconName = "cursor"`, `executableNames = ["cursor-agent", "cursor"]`, hooks at `~/.cursor/hooks.json`.

---

### 1.2 CLI Session Management Commands

| CLI | Resume | Rename | Archive | Delete |
|-----|--------|--------|---------|--------|
| Grok | `grok --resume <id>` | No CLI command; write `summary.json` | No native concept | No CLI; `rm -rf` session dir |
| Claude Code | `claude --resume <id>` or `claude -r "<id>"` | No CLI command | No native concept | No CLI; `unlink <uuid>.jsonl` |
| Codex | `codex resume <id>` | No CLI command; `UPDATE threads SET title = ?` | `UPDATE threads SET archived = 1` (native DB) | No CLI delete; no delete in `manage.py` |
| Copilot | `copilot --resume=<id>` | Unknown | Unknown | Unknown |
| Cursor | `cursor-agent --resume <id>` | No CLI command; write `meta.json` | No native concept | No CLI; `rm -rf` session dir |

**Citations:**  
- Resume commands: `muxy-ai-session-history:src/lib/resume.js:1-25`.  
- Claude CLI reference (rename by name via `-r`): `https://code.claude.com/docs/en/cli-reference`.  
- Rename/archive/delete implementation: `muxy-ai-session-history:src/lib/sessions/manage.py`.

---

### 1.3 Human-Readable Identifiers vs. Opaque IDs

| CLI | Opaque ID | Human title source | Branch stored? |
|-----|-----------|-------------------|----------------|
| Grok | UUID (dir name) | `summary.json` → `generated_title` (AI-generated) | No |
| Claude | UUID (filename stem) | JSONL event `custom-title` or `ai-title`; fallback: first user message | Yes (`gitBranch` in records) |
| Codex | UUID (DB `id`) | DB `title` column; fallback `first_user_message` | Yes (`git_branch` column) |
| Copilot | Unknown (UUID or shorter hex) | Unknown; possibly `meta.json:name` | No |
| Cursor | Opaque ID (dir name, not always UUID) | `meta.json` → `title` or `name` | Yes (`branch` in meta.json) |

**Note on Copilot IDs:** `sanitize.js:SESSION_ID_RE` relaxes the UUID requirement to allow `[0-9a-zA-Z][0-9a-zA-Z._-]{5,128}` for Copilot, acknowledging its IDs may not be standard UUIDs. Citation: `muxy-ai-session-history:src/lib/sanitize.js:14-18`.

---

## 2. GitHub Copilot CLI Session Titles — The UUID Problem

### Why sessions show only bare UUIDs

The Copilot CLI does **not document** its on-disk session storage format. The scanner (`list_copilot`) must use a defensive multi-probe strategy:

1. **DB probe:** Opens `~/.copilot/session-store.db` (if present), queries `sqlite_master` to discover which tables exist, then probes column names dynamically. If none of the probed table names (`sessions`, `session`, `session_docs`, `chronicle`) exist, the DB path is skipped entirely.
2. **Directory probe:** Scans `~/.copilot/session-state/<id>/`. Tries to read `meta.json` for `name` or `title`; if absent, **falls back to `child.name` (the raw UUID/ID string)** as the title.

**Result:** Without `meta.json` containing a `name`/`title` field, the displayed title _is_ the directory name (UUID). Unless Copilot CLI writes human-readable metadata into `meta.json`, there is no way to derive a title.

**Possible remediation (not yet implemented):** Read the session transcript file (if any) to extract the first user message. The scanner does not yet attempt this for Copilot. No official schema for Copilot transcript files has been found.

**Citation:** `muxy-ai-session-history:src/lib/sessions/scanner.py:277-361` (`list_copilot` full function).

---

## 3. Replacing Python Helper Scripts in a Muxy Extension

### 3.1 Host Constraints (Verified)

| Constraint | Evidence |
|------------|----------|
| Panel is `WKWebView` | `muxy/docs/extensions/panels.md:1` — "A panel is a webview that docks beside the workspace … each panel is its own `WKWebView`" |
| `runScript` is JavaScriptCore | `muxy/docs/extensions/scripts.md:1` — "runs a JavaScript file in an in-process JavaScriptCore context" |
| Neither has Node.js `fs` | No `require('fs')` or `node:fs` available; both are sandboxed JS runtimes |
| `muxy.files` is worktree-relative | `muxy/docs/extensions/files.md:3-4` — "every `path` is **relative to the active worktree root**" + "Paths are sandboxed to the workspace root. Any path that escapes it … is rejected." |
| `muxy.exec` runs on host PATH | `muxy/docs/extensions/scripts.md:~remote-workspaces` — "When the active workspace is a remote (SSH) workspace, `muxy.exec` … execute **on the remote server**, not the Mac." |
| `muxy.exec` uses login-shell PATH | `muxy/Muxy/Services/Providers/CopilotProvider.swift:38` — `requiresLoginShellEnvironmentForConfiguration = true`; `which.js` uses `["bash", "-lc", "command -v <name>"]` to detect CLIs with login-shell PATH |

**Critical implication:** There is no `muxy`-native API to read files outside the active worktree (e.g. `~/.claude/`, `~/.codex/`). The **only** path to home-directory data is through `muxy.exec`.

**Citation for `muxy.exec` being the sole escape hatch:** `muxy/docs/extensions/files.md` (sandbox), `muxy/docs/extensions/overview.md:architecture` section.

---

### 3.2 Alternatives for Scan/Manage Without a Node Runtime

#### A) Keep Python 3 on PATH (current approach)

**How it works:** `muxy.exec(["python3", "-", cli, cwd], { stdin: scannerSource })` — the entire script source is piped as stdin. Python reads `sys.stdin` implicitly when invoked as `python3 -`.

| Pros | Cons |
|------|------|
| Rich stdlib (`sqlite3`, `json`, `pathlib`, `urllib.parse`, `hashlib`) covering all 5 CLIs | Python 3 is not guaranteed on remote SSH hosts (e.g. minimal Linux containers, some CI images) |
| Single well-tested implementation | Startup latency (~100–300ms on first call per process) |
| Atomic logic in one file | Must be bundled as raw string at build time (`?raw` import) |
| SSH-transparent (runs on remote) | `python3` vs `python` name varies (macOS 14+ ships `python3` via Xcode CLT; raw Linux may lack it) |

**Citation:** `muxy-ai-session-history:src/lib/sessions/scan.js:30-39` — uses `["python3", "-", cli, cwd]` with `stdin: scannerSource`.

---

#### B) Port to pure JavaScript via `muxy.exec` (sqlite3 CLI, jq, find, rm)

**How it works:** Run shell tool chains: `sqlite3 ~/.codex/state_*.sqlite "SELECT …" -json`, `find ~/.claude/projects`, `jq` for JSON parsing.

| Pros | Cons |
|------|------|
| No Python required | `sqlite3` CLI, `jq`, and `find` all have varying availability and flag differences (macOS vs Linux) |
| JS logic can live in the extension panel itself | Multi-command orchestration requires many `muxy.exec` round-trips or complex shell pipelines |
| No interpreter startup | `jq` is not installed by default on macOS or most Linux servers |
| | `sqlite3` CLI output format differs across versions; `.mode json` not universal |
| | Encoding/quoting edge cases in shell pipelines are severe for arbitrary cwd paths |
| | JSONL parsing without `jq` requires awk/sed, fragile against malformed lines |

**Verdict:** Not recommended. Replaces one optional dependency (Python) with several (jq, sqlite3 CLI, find flags), and creates a fragile multi-tool chain.

---

#### C) Shell scripts (bash/zsh) via `muxy.exec`

**How it works:** Bundle shell scripts as `?raw`, pipe via `bash -s -- <args>` or `zsh -s`.

| Pros | Cons |
|------|------|
| `bash` is nearly universal | Shell cannot parse SQLite or JSON natively |
| Simple for basic `find`/`rm` ops | Requires `sqlite3` CLI for Codex support (not standard) |
| | POSIX `sh` has no associative arrays; bash 4+ required for complex logic but macOS ships bash 3.2 |
| | Multi-line string handling for JSON is error-prone in shell |

**Verdict:** Suitable only for simple delete/find operations, not for title extraction or SQLite access.

---

#### D) Node/Bun scripts if on PATH

**How it works:** Bundle as JS string, invoke via `node -e "$(cat)" --` or `bun -e`.

| Pros | Cons |
|------|------|
| Full Node stdlib available (`fs`, `sqlite3` via native module) | Node is not installed by default on most SSH servers |
| Bun has built-in SQLite (`bun:sqlite`) | Bun is even less common on remote hosts |
| Familiar for JS developers | Extension already uses Bun locally for build, but `bun` on PATH ≠ bun on remote host PATH |

**Verdict:** Not portable for remote workspaces. Both Bun and Node are development tools, not server utilities.

---

#### E) Any Muxy-native API for home-directory FS beyond exec

**Searched:** `muxy/docs/extensions/files.md`, `muxy/docs/extensions/scripts.md`, `muxy/docs/extensions/overview.md`, `muxy/docs/extensions/manifest.md`, all extension docs.

**Finding:** There is **no** Muxy-native API to read outside the worktree sandbox. `muxy.files` is explicitly sandboxed to the active worktree root; escaping via `..` or symlinks is rejected. There is no `muxy.home`, `muxy.homedir`, or equivalent. **`muxy.exec` is the only path to home-directory data.**

**Citation:** `muxy/docs/extensions/files.md:3-4` — "Paths are sandboxed to the workspace root. Any path that escapes it — via `..` or a symlink pointing outside — is rejected."

---

### 3.3 Recommendation

**Keep Python 3 (Option A)** is the most portable approach for local + SSH remote workspaces _without_ assuming a Node runtime on the host. Python 3 is present on:
- macOS 12+ (via Xcode Command Line Tools at `/usr/bin/python3`)
- Ubuntu 20.04+ (standard install)
- Debian, Fedora, Arch — ships in base system

The `python3 -` stdin pattern is already proven, handles all 5 CLIs with proper SQLite, JSONL, and JSON support, and the full source is bundled at build time via `?raw` imports, making it host-install-independent beyond needing `python3` in PATH.

**Robustness improvement:** Consider adding a pre-flight check — `muxy.exec(["bash", "-lc", "command -v python3"])` — and surfacing a clear error if missing, rather than a cryptic `python3: command not found` in stderr.

---

## 4. Muxy Core Provider Icons

### 4.1 Location and Names

All provider SVG icons are bundled inside the Muxy macOS app at:
```
Muxy.app/Contents/Resources/Muxy_Muxy.bundle/ProviderIcons/
```
(resolved at runtime via `Bundle.providerIconsURL` or `Bundle.appResources`).

**Files present (verified):**

| Filename | Provider |
|----------|---------|
| `grok.svg` | Grok (xAI) |
| `claude.svg` | Claude Code (Anthropic) |
| `codex.svg` | Codex CLI (OpenAI) |
| `copilot.svg` | GitHub Copilot |
| `cursor.svg` | Cursor |
| `amp.svg` | Amp |
| `opencode.svg` | OpenCode |
| `minimax.svg` | MiniMax |
| `factory.svg` | Factory |
| `kimi.svg` | Kimi |
| `zai.svg` | Zai |
| `pi.svg` | Pi |

**Citation:** `glob /Users/gerlaca1/Projects/swift/muxy/Muxy/Resources/ProviderIcons/*.svg` (12 files).

### 4.2 How Core App Loads Them

Each Swift provider struct declares `iconName: String`. For example:
- `GrokProvider.swift:4` — `let iconName = "grok"`
- `CopilotProvider.swift:4` — `let iconName = "copilot"`
- `CodexProvider.swift:4` — `let iconName = "codex"`
- `CursorProvider.swift:4` — `let iconName = "cursor"`
- `ClaudeCodeProvider.swift:4` — `let iconName = "claude"`

`ProviderIconView.swift` uses the `iconName` to load the SVG:
```swift
Bundle.appResources.url(forResource: name, withExtension: "svg",
                        subdirectory: "ProviderIcons")
```
It detects colorful SVGs (pixel-sample heuristic) and renders them as full color; monochrome SVGs are rendered as template images tinted with `MuxyTheme.fg`.

**Citation:** `muxy/Muxy/Views/Components/Icons/ProviderIconView.swift:10-125`.

### 4.3 Can Extensions Reference Core Icons?

**No.** The Muxy extension API exposes only two icon forms in the manifest:
```json
{ "icon": { "symbol": "<sf-symbol-name>" } }
{ "icon": { "svg": "path/to/icon.svg" } }
```
The `svg` path must be **inside the extension's `dist/` directory** — it cannot point outside the extension bundle. There is no API to reference core app icons by name.

**Citation:** `muxy/docs/extensions/manifest.md:Icons` section — "a path relative to the build output to a `.svg` file. The file must exist in `dist/` at load time, must not escape the extension directory".

**Consequence for the extension:** To show provider logos (grok, claude, copilot, etc.) in the panel, the extension must either:
1. Vendor copies of each SVG into `dist/assets/` and reference as `<img src="…">` or inline `<svg>`, **or**
2. Use SF Symbols or pure CSS/text fallbacks.

The current extension does **not** vendor provider SVGs — it uses text chip labels (`"Grok"`, `"Claude"`, etc.) in the toolbar filter chips. No provider icon is shown per session row.

### 4.4 SF Symbols vs. Lucide for Action Icons

The current extension uses **Lucide SVG paths inlined** in `icons.js`, not SF Symbols. All six action icons are hardcoded `<svg>` path strings:

| Icon name | Purpose | Lucide path used |
|-----------|---------|-----------------|
| `sparkles` | New session / AI branding | Two-stroke sparkle |
| `refresh` | Refresh session list | Circular arrow |
| `pencil` | Rename session | Pencil with corner edit lines |
| `archive` | Archive session (box with line) | Box + horizontal line |
| `archive-restore` | Unarchive (box with right-arrow) | Box + arrow pointing right |
| `trash` | Delete session | Bin with lid |

**Citation:** `muxy-ai-session-history:src/lib/icons.js:3-20`.

The manifest uses **SF Symbols** for chrome items (panel header, topbar):
- Panel icon: `{ "symbol": "clock.arrow.circlepath" }`
- Refresh header button: `{ "symbol": "arrow.clockwise" }`
- Topbar icon: `{ "symbol": "clock.arrow.circlepath" }`

**Citation:** `muxy-ai-session-history:package.json` — `muxy.panels[0].icon`, `muxy.panels[0].headerButtons[0].icon`, `muxy.topbarItems[0].icon`.

SF Symbol usage is limited to `{ "symbol": … }` objects in the manifest (topbar, panel header, status bar). In-panel webview UI uses inline SVG. This is correct — `WKWebView` cannot render SF Symbols natively; the manifest `"symbol"` fields are processed by the native host, not the webview.

---

## 5. Current Extension Assumptions vs. Primary-Source Reality

### 5.1 `providers.js` Capabilities Matrix

**File:** `muxy-ai-session-history:src/lib/sessions/providers.js`

```js
{ id: "grok",    capabilities: { rename: true,  archive: true,  delete: true  } }
{ id: "claude",  capabilities: { rename: false, archive: true,  delete: true  } }
{ id: "codex",   capabilities: { rename: true,  archive: true,  delete: false } }
{ id: "copilot", capabilities: { rename: false, archive: true,  delete: false } }
{ id: "cursor",  capabilities: { rename: true,  archive: true,  delete: true  } }
```

**Validation against primary sources:**

| CLI | `rename` | `archive` | `delete` | Status |
|-----|----------|-----------|---------|--------|
| Grok | ✅ Implemented in `manage.py:rename_grok` — writes `summary.json` | ⚠️ Archive stored in `muxy.storage` only (no native concept) | ✅ `manage.py:delete_grok` — `shutil.rmtree` | Rename + delete: correct. Archive is Muxy-only — no native state, which is fine but undocumented in code. |
| Claude | ✅ No rename in `manage.py` (correct) | ⚠️ Muxy-storage only | ✅ `manage.py:delete_claude` — `unlink` JSONL file | Correct. No Claude CLI rename command exists. |
| Codex | ✅ `manage.py:rename_codex` — `UPDATE threads SET title = ?` | 🔴 **BUG** — `archive_codex` sets `archived = 1` in DB, but scanner `WHERE archived = 0` excludes them; archived sessions disappear permanently, unarchive is impossible from the panel | `delete: false` — ✅ correct, no delete implemented | Archive flag is misleading — it silently hard-archives. See §5.3. |
| Copilot | `rename: false` — ✅ reasonable given unknown schema | `archive: true` — ✅ stored in `muxy.storage` only (no native DB write attempted for Copilot) | `delete: false` — ✅ reasonable | Correct. The UUID title issue is not a capabilities mismatch but a metadata discovery gap. |
| Cursor | ✅ `manage.py:rename_cursor` — writes `meta.json` | ⚠️ Muxy-storage only | ✅ `manage.py:delete_cursor` — `shutil.rmtree` | Correct. |

---

### 5.2 `scanner.py` Title Extraction per CLI

| CLI | Title source | Accuracy |
|-----|-------------|---------|
| Grok | `summary.json` → `generated_title` / `session_summary` / `agent_name` | ✅ Correct — these are the actual Grok storage fields |
| Claude | JSONL `custom-title` / `ai-title` / `summary` events; fallback to first user message | ✅ Correct — internal event types match observed Claude format; robust fallback chain |
| Codex | SQLite `title` column; fallback `first_user_message` | ✅ Correct — DB columns are real; defensive handling of missing columns is appropriate |
| Copilot | DB probe (multiple table/column guesses); directory `meta.json:name/title`; fallback to **UUID string** | ⚠️ UUID fallback is expected when no metadata exists; no first-message extraction attempted |
| Cursor | `meta.json` → `title` / `name` | ✅ Correct — matches Cursor's known metadata format |

**Copilot UUID title root cause (confirmed):** `scanner.py:340-352` — when `meta.json` is absent or lacks `name`/`title`, `title = child.name` which is the session directory name (UUID). No transcript file reading is attempted for Copilot to extract a first user message.

---

### 5.3 Critical Bug: Codex Archive = Permanent Hide

**The exact mismatch:**

1. `manage.py:archive_codex` → `UPDATE threads SET archived = 1 WHERE id = ?` *(citation: `manage.py:177-211`)*
2. `scanner.py:list_codex_db` → `WHERE archived = 0` *(citation: `scanner.py:245`)*
3. `manage.js:archiveSession` for `cli === "codex"` calls `archive_codex`, then `setSessionArchived` in `muxy.storage` *(citation: `manage.js:57-67`)*
4. The panel filters by `s.archived` which comes from `archivedSet` (Muxy storage), but the session row is never returned by the scanner after native archiving

**Effect:** A Codex session that is archived via the panel will:
- Be hidden from the scanner immediately (native DB `archived = 1`)
- Never appear again (scanner always filters `WHERE archived = 0`)
- Have an orphaned entry in `muxy.storage` `archivedSessions` set
- **Cannot be unarchived** because the panel never shows it

This was flagged in `code_review_muxy-ai-session-history_1005d62.md:Critical Issues §1` and is confirmed by the code.

**Fix options (not implemented here):**
- Option A: Remove `AND archived = 0` from the scanner query; add `archived` to the session row; let the panel handle filtering.
- Option B: Stop writing to the native Codex DB `archived` column; keep archive state purely in `muxy.storage`.
- Option C: Add a separate query path that fetches archived Codex threads when `showArchived = true`.

---

### 5.4 `manage.py` Supported Operations — Complete Matrix

| Action | CLI | Implementation | Notes |
|--------|-----|---------------|-------|
| `rename` | grok | Write `summary.json:generated_title` | Non-atomic (bug: should use tmp + `os.replace`) |
| `rename` | codex | `UPDATE threads SET title = ?` | Correct |
| `rename` | cursor | Write `meta.json:title` | Non-atomic (same bug) |
| `rename` | claude / copilot | Returns `err(...)` | Correct — not supported |
| `delete` | grok | `shutil.rmtree(session_dir)` | Correct |
| `delete` | claude | `target.unlink()` — removes `.jsonl` | Correct |
| `delete` | cursor | `shutil.rmtree(session_dir)` | Correct |
| `delete` | codex / copilot | Returns `err(...)` | Correct — not supported |
| `archive` | codex | `UPDATE threads SET archived = ?` | Feeds the hide-forever bug |
| `archive` | all others | Returns `err(...)` | Correct — Muxy-storage handles non-codex |

**Citation:** `muxy-ai-session-history:src/lib/sessions/manage.py:1-250` (full file).

---

### 5.5 Binary Detection Mismatch: Copilot

`providers.js` declares `binaries: ["copilot"]` for Copilot. The `which.js` detector runs `bash -lc 'command -v copilot'`.

However, the GitHub Copilot CLI may be installed as:
- A standalone `copilot` binary (confirmed by `CopilotProvider.swift:executableNames = ["copilot"]`)
- Via `gh extension install github/gh-copilot` → invoked as `gh copilot` (not `copilot`)

The standalone `copilot` binary (installed via `npm install -g @githubnext/copilot-cli` or similar) uses the `copilot` name. The `gh copilot` extension variant is a different invocation path and is **not** detected by this extension. This is a known limitation but is consistent with the Muxy core provider registration.

**Citation:** `muxy/Muxy/Services/Providers/CopilotProvider.swift:8` — `let executableNames = ["copilot"]`.

---

## 6. Summary Table: Verified Capabilities vs. Extension Claims

| | Grok | Claude | Codex | Copilot | Cursor |
|-|------|--------|-------|---------|--------|
| **Storage format** | JSON | JSONL | SQLite + JSONL | SQLite? (unconfirmed) | JSON |
| **Title stored natively** | ✅ `generated_title` | ✅ via events | ✅ `threads.title` | ❓ Unknown | ✅ `meta.json.title` |
| **Branch stored** | ❌ | ✅ | ✅ | ❌ | ✅ |
| **Resume command** | `--resume <id>` | `--resume <id>` | `resume <id>` | `--resume=<id>` | `--resume <id>` |
| **Extension rename** | ✅ (file write) | ❌ | ✅ (DB UPDATE) | ❌ | ✅ (file write) |
| **Extension archive** | ⚠️ Muxy-only | ⚠️ Muxy-only | 🔴 BUG (hides forever) | ⚠️ Muxy-only | ⚠️ Muxy-only |
| **Extension delete** | ✅ | ✅ | ❌ | ❌ | ✅ |
| **UUID-only titles** | Rare (has `generated_title`) | Rare (has event types) | Rare (has `title` col) | **Common** (no metadata) | Rare (has `meta.json`) |

---

## 7. Gaps and Uncertainties

| Item | Status |
|------|--------|
| Copilot CLI session DB schema | **Unverified** — no public documentation; DB path and table/column names are guesses in scanner code |
| Copilot CLI session-state directory structure | **Unverified** — `session-state/<id>/meta.json` is guesswork; may not exist |
| Grok `summary.json` exact schema | **Partially verified** via scanner field names; no official Grok CLI docs consulted (closed-source) |
| Codex JSONL `session_meta` payload fields | **Partially verified** — `id`, `cwd`, `git.branch`, `source` observed in scanner code; no official OpenAI schema doc |
| Whether `copilot --resume=<id>` is the correct flag | **Assumed** from `resume.js:9`; not confirmed from official Copilot CLI help output |
| Cursor Agent CLI session format | **Partially verified** — `meta.json` fields inferred from scanner; no official Cursor Agent CLI docs |
| `muxy.ui.prompt` / `muxy.ui.confirm` API stability | **Unclear** — used in `panel/app.js` but not documented in Muxy extension docs; likely an undocumented internal bridge |
| Provider icon vendoring in the extension | **Confirmed absent** — extension does not vendor provider SVGs; shows text labels only |
| Whether archived Codex sessions ever appear | **Confirmed broken** — they do not appear with current code |

---

*All citations refer to files on disk at the paths shown. Muxy extension API citations are from `/Users/gerlaca1/Projects/swift/muxy/docs/extensions/`. Extension source citations are from `/Users/gerlaca1/Projects/swift/muxy-ai-session-history/`.*
```

---

Here is the complete **RESEARCH.md** written above. Below is a summary of what was found and verified:

## Summary of findings

### Key discoveries

1. **Session storage is fully reverse-engineered** from `scanner.py` and the Muxy Swift provider files, not from official CLI documentation (which is either absent or sparse for Grok, Copilot, and Cursor):
   - **Grok:** `~/.grok/sessions/<url-encoded-cwd>/<uuid>/summary.json` — JSON, `generated_title` field
   - **Claude:** `~/.claude/projects/<slug>/` — JSONL event stream; title only in `custom-title`/`ai-title` events
   - **Codex:** `~/.codex/state_N.sqlite` — `threads` table with `title`, `first_user_message`, `archived`, `git_branch`; older installations fall back to JSONL with **no title**
   - **Copilot:** Schema **not publicly documented**; scanner probes multiple table/column name guesses; UUID titles are expected when no `meta.json` metadata exists
   - **Cursor:** `~/.cursor/chats/<md5(cwd)>/<id>/meta.json`

2. **Critical Codex archive bug confirmed** (`scanner.py:245` `WHERE archived = 0` vs `manage.py:archive_codex` setting `archived = 1`) — archived sessions disappear forever; unarchive is impossible with the current code.

3. **Muxy has no home-directory FS API** — `muxy.files` is strictly worktree-sandboxed; `muxy.exec` is the only escape hatch, making Python the most portable choice.

4. **Provider icons are in-app resources only** — extensions cannot reference core `ProviderIcons/*.svg`; must vendor or use text labels.

5. **All action icons are Lucide SVG paths** inlined in `icons.js`; manifest chrome items use SF Symbols.
