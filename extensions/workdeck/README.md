# Workdeck

A work hub for [Muxy](https://muxy.app): a project-group sidebar, issue and deploy management, branch cleanup,
KakaoTalk-to-issue, and an agent control room — in one extension.

Author: Wonjin · Languages: English, 한국어 (follows the system language; change it from the sidebar's `⋯` menu).

## What it does

**Sidebar** (replaces the built-in one; switch back any time from `⋯ → Sidebar`)
- Muxy workspaces become **groups**. Drag projects between groups, search, sort (manual, name, recent activity, date added).
- Folders you add are scanned for repositories and submodules, which are shown nested under the folder.
- Home stays pinned on top. Hover a row for **＋** (new tab there). Project menu: worktrees, color, icon, Finder, remove.
- **Agents** section with live status and the agent's icon, **Remote** section for SSH servers (one tab per connection),
  resizable sections, and an icon-only compact mode when the sidebar is narrow.

**Per-project tools** (right-click a project → *Manage*)
- **New issue…** — a modal to write an issue for **GitHub or Linear**: markdown editor with preview, templates,
  labels, assignee, Linear team / project / status / priority. Or build the issue **from a KakaoTalk conversation**
  (see below).
- **Issues** — GitHub and Linear side by side. Linear sub-issues are shown as groups. Change Linear status with one
  click, link a Linear project (auto-matched by repository name, or searchable picker), comment, close or reopen.
- **Deploys** — PR review (checks, files, full diff, reviews, merge) and Actions progress with *which branch merges into
  which branch*, job and step detail, re-run / cancel, workflows and releases.
- **Branch cleanup** — finds local and remote branches already merged into `main` / `master` / `develop` (including
  squash-merged ones, matched through merged PRs) and deletes the ones you tick. Protected branches, the current branch
  and branches checked out in a worktree are never offered; each delete re-checks the branch tip first.
- **Hand any issue or PR to an AI agent** with one click: pick Claude Code, Codex, OpenCode, Cursor Agent, Copilot CLI,
  Gemini CLI, XITA or your own agent (add / edit / delete them in *Manage agents*).

**Notes** (right-click a workspace or project → *Notes…*, or the top-bar note button / `ctrl+shift+n` for a quick memo)
- Notes have a scope: global, a workspace, or a project. Each note is a plain Markdown file under
  `~/.workdeck/notes/<scope>/` (the folder is a setting), so any editor can open it. Edit or delete memo by memo.
- **Quick note** saves one line into the chosen scope's running note. *Save and file as issue* hands the memo to the
  issue form (GitHub or Linear). Enter saves, Shift+Enter adds a line.
- **Writing helper** starts an agent (any agent from *Manage agents*) and chats with it. The conversation is written into
  the memo as it goes (the agent keeps a summary file up to date, the screen is kept as the conversation record), so a
  session that dies loses nothing recorded so far, and a memo can be continued in a new session later.
  When the helper ends, or its tab is closed, the agent session it started is ended and its terminal tab closed. As a safety net the agent command also starts a small watchdog that ends that agent's own session if the notes page has stopped sending a heartbeat for 3 minutes.

**Agent control room** — one tab with every running agent as a live card: its terminal screen rendered as chat,
reply box, approve / deny keys when it waits for input, interrupt, and notification toasts.

**KakaoTalk → issue** (optional)
Pick a chat room (favorites first, star to favorite), tick messages in a chat-bubble view with photos, choose the AI
provider and model, add your own notes, review and revise the draft, then create it on GitHub or Linear.
This uses the local `kakao-linear` command-line tool from KakaoToLinear; the extension looks for it on your `PATH`, in `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, or inside `KakaoToLinear.app` (`Contents/MacOS/kakao-linear`). Set up your Linear and AI keys once with the KakaoToLinear app or `kakao-linear auth linear` / `kakao-linear auth ai`. Reading KakaoTalk needs **Full Disk Access** for Muxy — the
error box has a button that opens the right System Settings page.

## Requirements

| Feature | Needs |
| --- | --- |
| GitHub issues, PRs, Actions | [`gh`](https://cli.github.com) installed and logged in (`gh auth login`) |
| Linear | `LINEAR_API_KEY` exported in your shell profile (`~/.zshrc`) |
| KakaoTalk → issue | `kakao-linear` on `PATH`, KakaoTalk for macOS, Full Disk Access for Muxy |
| Remote section | servers configured in Muxy's settings (SSH keys or agent; Muxy connects without prompts) |

Muxy asks for approval the first time the extension runs a command (`gh`, `git`, `muxy`, `kakao-linear`, …).

## Why each permission is needed

| Permission | Used for |
| --- | --- |
| `projects:read` / `projects:write` / `projects:delete` | list projects and workspaces, move projects between groups, rename / reorder / remove them |
| `worktrees:read` / `worktrees:write` | show and switch worktrees |
| `git:read` | current branch per project |
| `tabs:read` / `tabs:write` | list and open tabs, move manager tabs into the right project, close / rename / pin tabs |
| `agents:read` / `agents:write` | agent status in the sidebar and control room, jump to an agent's pane |
| `commands:exec` | run `gh`, `git`, `muxy`, `kakao-linear` and the Linear API call |
| `commands:read` / `commands:run` | start Muxy's *Open Project…* and *New Worktree* commands |
| `ui:write` | open Settings from the sidebar footer and remote menu |
| `panels:write` | the *New issue* modal and the sidebar-switcher popover |
| `preferences:read` | follow theme and preference changes |
| `storage:read` / `storage:write` | remember collapsed groups, section sizes, agents, Linear project matches, last choices |
| `clipboard:write` | *Copy path* |
| `system:open` | open links, reveal in Finder, open a project in another app |

## Languages

The UI text is Korean-keyed with an English table in `i18n.js`. The language is the saved choice (sidebar `⋯ → Language`)
or the system language. To add a language, add a table to `I18N` and list it in `LANGUAGES`.

## Screenshots

English screenshots with invented demo data (no real projects, repositories, issues or chats) are generated from the
real pages by the demo harness in [`demo/`](demo/) — see [`demo/README.md`](demo/README.md).

## Layout

```
sidebar/   the sidebar page (core, add, view, main)
tab/       issues, deploys, branch cleanup and agent-control-room tabs, shared lib and agent launcher
modal/     the New issue modal (GitHub / Linear / KakaoTalk)
notes/     notes: storage (store.js), the notes tab and the quick-note modal
switcher/  the top-bar popover that switches the active sidebar
assets/    icons
demo/      demo harness for screenshots (not loaded by the extension)
i18n.js    translations
```

## License

MIT © 2026 Wonjin — free for anyone to use, modify and share. See [LICENSE](LICENSE).
