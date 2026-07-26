# Git Workspace

Git for multi-repo workspaces. Open one folder that contains several git repositories and manage all of them from a single Source Control panel — no need to open each repo as a separate Muxy project.

A fork of the official [git extension](https://github.com/muxy-app/extensions/tree/main/extensions/git) that adds a repository switcher and GitLab support on top of everything it already does (changes, commits, branches, history graph, and pull requests for GitHub, GitLab, Forgejo, and Gitea).

## Features

- **Repository switcher** at the top of the panel — pick any repository inside the workspace folder, with branch name and dirty-file count shown for each.
- **Workspace folder detection** — if the opened project is itself a git repository, sibling repositories in its parent folder are offered; if it is a plain folder holding several projects, only repositories inside it are listed and the first one opens by default.
- **Change workspace folder…** from the switcher to scan any other folder; the choice is remembered per project.
- **`Git Workspace: Switch Repository…`** palette command, and `cmd+shift+y` to toggle the panel — intentionally different from the official git extension's `cmd+y`, so both can be installed side by side.
- **Auto-refresh** while viewing a repository other than the active worktree (polls every 3 s, paused while the panel is hidden or a git operation is running).
- Everything from the upstream extension still works against the selected repository: stage/commit/discard, branch switching, history graph, diff viewer, PRs, and CI runs.

## Pull request backends

The PR features auto-detect the forge from the repository's `origin` remote:

- **GitHub / GitHub Enterprise** → the [`gh`](https://cli.github.com) CLI.
- **GitLab / self-managed GitLab** → the [`glab`](https://gitlab.com/gitlab-org/cli) CLI, for
  `gitlab.com` remotes or hosts in your `glab auth status` logins (merge requests and CI pipelines).
- **Forgejo / Gitea** → the [`tea`](https://gitea.com/gitea/tea) CLI, when the
  remote host matches one of your `tea login list` entries.

Plain source control (status, commit, branch, diff, worktrees) uses `git` alone and needs neither CLI.

## Permissions

- `commands:exec` — runs `git` for repository work, `find` for repository discovery, `gh`/`glab`/`tea` for pull requests, and `osascript` for the native folder picker.
- `worktrees:read` / `worktrees:write` — resolve the active worktree and create/remove PR worktrees.
- `panels:write`, `tabs:write` — the Source Control panel and the diff-viewer tab.
- `notifications:write` — completion/error toasts for git actions.
- `files:read` — reading repo files for diff rendering (inherited from upstream).
- `git:write` — worktree switch/remove via the app's git core.

## Building

```sh
npm install --ignore-scripts
npm run build
```

Then load the `dist/` folder via **Load Unpacked** in Muxy's Extensions modal (or click **Reload** after rebuilding).
