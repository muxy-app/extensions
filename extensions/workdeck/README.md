# Workdeck

A work hub for [Muxy](https://muxy.app): a project-group sidebar, issue and deploy management (issues can be handed to
an agent that works in its own worktree), branch cleanup, notes, KakaoTalk-to-issue, and an agent control room — in one
extension.

Author: Wonjin · Languages: English, 한국어 (follows the system language; change it from the sidebar's `⋯` menu).

## What it does

**Sidebar** (replaces the built-in one; switch back any time from `⋯ → Sidebar`)
- Muxy workspaces become **groups**. Drag projects between groups, search, sort (manual, name, recent activity, date added).
- Folders you add are scanned for repositories and submodules, which are shown nested under the folder. Repositories in
  a git-ignored folder (SwiftPM `.build/checkouts`, vendored clones) are skipped. *Rescan repositories* in a project's
  menu looks again and offers what is new.
- Home stays pinned on top. Hover a row for **＋** (new tab there). Project menu: worktrees, color, icon, Finder, remove.
- Open tab lists stay open when you move to another project, including the last active worktree's. Text cut off with
  `…` shows in full when the pointer rests on it.
- **Agents** section with live status and the agent's icon (the agent in the focused terminal is highlighted),
  **Remote** section for SSH servers (one tab per connection), resizable sections, and an icon-only compact mode when
  the sidebar is narrow.

**Per-project tools** (right-click a project → *Manage*)
- **New issue…** — a modal to write an issue for **GitHub or Linear**: markdown editor with preview, templates,
  labels, assignee, Linear team / project / status / priority. Or build the issue **from a KakaoTalk conversation**
  (see below). After an issue is created, *New issue* starts the next one in the same window.
- **Issues** — GitHub and Linear side by side (the one you looked at last opens first). Linear sub-issues are shown as
  groups. Change Linear status with one click, link a Linear project (auto-matched by repository name, or searchable
  picker), comment, close or reopen.
- **Deploys** — PR review (checks, files, full diff, reviews and comments newest first, merge) and Actions progress with
  *which branch merges into which branch*, job and step detail, re-run / cancel, workflows and releases.
- **Branch cleanup** — finds local and remote branches already merged into `main` / `master` / `develop` (including
  squash-merged ones, matched through merged PRs) and deletes the ones you tick. Protected branches, the current branch
  and branches checked out in a worktree are never offered; each delete re-checks the branch tip first.
- **Hand any issue or PR to an AI agent**: Claude Code, Codex, OpenCode, Cursor Agent, Copilot CLI, Gemini CLI, XITA or
  your own agent (add / edit / delete them in *Manage agents*, where you also set the default agent and a default model
  and effort per agent).
- **Running an issue with an agent** asks for the agent, model and effort, then:
  - creates a git worktree and branch for the issue under `~/.local/share/workdeck/worktrees/<repo>-<id>/<branch>`
    (Linear's branch name when it has one), starting from origin's default branch after a `git fetch` (or from the
    remote branch if it already exists there). A branch that already has a worktree, from an earlier run, is reused;
  - copies the main checkout's git-ignored `.env` / `.env.*` files into that worktree, so the project runs there without
    touching your checkout (a checkbox in the dialog, on by default; the files are only copied, never read or sent);
  - starts the agent in that worktree with the issue and the *issue instructions* (English, editable in *Manage agents*):
    analyze and report first, agree on a direction with you, then implement, verify, commit locally, comment progress on
    the issue, and move it to review (Linear review status, or a review label on GitHub). The instructions tell it not to
    push, merge or close the issue unless you ask;
  - marks the issue (and the sub-issues of a group) as running until the agent's terminal tab is closed, so it cannot
    be started twice.

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

Files the extension writes outside your projects: notes under `~/.workdeck/notes` (configurable); the prompt and the
model / effort choice handed to an agent, and the writing helper's session id and heartbeat, under
`~/.local/share/workdeck/run` (private to your account); issue worktrees under `~/.local/share/workdeck/worktrees`.
Remove a worktree you no longer need with `git worktree remove <folder>`.

## Why each permission is needed

| Permission | Used for |
| --- | --- |
| `projects:read` / `projects:write` / `projects:delete` | list projects and workspaces, move projects between groups, rename / reorder / remove them |
| `worktrees:read` / `worktrees:write` | show and switch worktrees, let Muxy pick up an issue worktree right after it is created |
| `git:read` | current branch per project |
| `tabs:read` / `tabs:write` | list and open tabs, move manager tabs into the right project, close / rename / pin tabs |
| `agents:read` | agent status in the sidebar and control room |
| `panes:read` | which terminal is focused (highlights its agent), whether an issue's agent tab is still open, and the session id printed in a XITA status line — that is how a row is matched to its terminal |
| `panes:write` | end an agent's terminal from the row's menu, after a confirmation, to clean up leftover sessions |
| `commands:exec` | run `gh`, `git` (including `git worktree add` for issue runs), `muxy`, `kakao-linear` and the Linear API call |
| `commands:read` / `commands:run` | start Muxy's *Open Project…* and *New Worktree* commands |
| `ui:write` | open Settings from the sidebar footer and remote menu |
| `panels:write` | the *New issue* modal and the sidebar-switcher popover |
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
tab/       issues, deploys, branch cleanup and agent-control-room tabs, shared lib, agent launcher, issue runs
modal/     the New issue modal (GitHub / Linear / KakaoTalk)
notes/     notes: storage (store.js), the notes tab and the quick-note modal
switcher/  the top-bar popover that switches the active sidebar
assets/    icons
demo/      demo harness for screenshots (not loaded by the extension)
i18n.js    translations
```

## License

MIT © 2026 Wonjin — free for anyone to use, modify and share. See [LICENSE](LICENSE).
