# Linear for Muxy

**English** · [한국어](README.ko.md) · [日本語](README.ja.md) · [中文](README.zh.md)

Browse your assigned Linear issues in a Muxy side panel and hand one to Claude
Code with a single click — it creates the branch (optionally in its own git
worktree) and launches your agent CLI seeded with an issue-aware prompt.

## Features

- **My issues panel** — issues assigned to you, grouped by workflow state, with
  the issue matching your current git branch pinned to the top.
- **Click an issue → start work** — pick the branch name (defaults to Linear's
  suggested `branchName`), the base branch, whether to use a separate git
  worktree, and the initial prompt, then launch Claude Code in a terminal tab.
- **Status change & comments** — right from the issue modal.
- **Create issue** — via the `Linear: New Issue` palette command or the panel `+`.

## Setup

1. Build (`npm install && npm run build`), then in Muxy open **Extensions →
   Load Unpacked** and pick the built **`dist/`** folder.
2. Open the panel (topbar icon or `Linear: Toggle Sidebar`), then open
   **Settings** (⚙). Click **🔑 Manage API keys** to register one or more Linear
   **Personal API Keys** (each with a description), then pick the active one from
   the **dropdown** on the settings screen
   (Linear → Settings → Security & access → Personal API keys). See
   [`docs/setup.md`](docs/setup.md) for the full initial-setup walkthrough.
3. Optionally set your default team key, base branch, worktree location, agent
   command, and prompt template. A **🌐 Global / 📁 This project** toggle lets you
   override the API key and core run values per repository (saved to `.linear.json`).
4. Set the UI **language** (English / 한국어 / 日本語 / 中文) in Settings.

## Permissions

- `panels:write` — open the panel and webview modals.
- `tabs:write` — open the terminal tab that runs the agent (first run also asks
  runtime consent for the auto-run command).
- `git:read` / `git:write` — read branches and create branches/worktrees.
- `projects:read` — react to project/branch switches to highlight the current issue.
- `commands:exec` — open an issue's URL in the browser (`open <url>`).

Linear API calls go to `api.linear.app` over `muxy.http.fetch`, which prompts for
host consent on first use. The API key is stored locally via `muxy.storage`.

## Prompt template placeholders

`{identifier}` `{title}` `{branch}` `{url}` `{description}` — the default is
`/리니어 {identifier}`, which drives the repo's Linear working skill.

## License

[MIT](LICENSE) © 2026 Namgyeong Kim.

This is an **unofficial** extension and is not affiliated with, endorsed by, or
sponsored by Linear or Muxy. "Linear" and "Muxy" are trademarks of their
respective owners.
