# Git

Official Git extension for Muxy — source control panel, branch switching,
diff viewer, and pull requests.

## Features

- **Source Control panel** (`cmd+y`) — staged/unstaged changes, stage,
  commit, and discard. In tree view, stage or unstage a whole folder at once.
- **Branch switcher** — switch and create branches from the status bar.
- **Diff viewer** — inline file diffs.
- **Pull Requests** — browse PRs and view the current PR for the branch.
- **Pull request picker** — search open PRs from the command palette, open
  details with `Enter`, or choose the default worktree or a new worktree with
  `Shift+Enter`.
- **Worktrees** — create and switch worktrees.

## Pull request backends

The PR features auto-detect the forge from the repository's `origin` remote:

- **GitHub / GitHub Enterprise** → the [`gh`](https://cli.github.com) CLI.
- **Forgejo / Gitea** → the [`tea`](https://gitea.com/gitea/tea) CLI, when the
  remote host matches one of your `tea login list` entries.

Install whichever CLI(s) you need and authenticate once (`gh auth login` /
`tea login add`). Detection is per repository, so GitHub and Forgejo repos work
side by side. Plain source control (status, commit, branch, diff, worktrees)
uses `git` alone and needs neither CLI.

## Remote workspaces

Source control runs through Muxy's own git integration (`muxy.git`), so the
panel follows the active project — including projects on remote (SSH) devices.
GitHub pull requests go through the same integration. The features Muxy's git
API does not cover — Forgejo/Gitea pull requests, GitHub Actions runs, fetch,
merge/rebase, and aborting an in-progress operation — shell out to `git`, `gh`,
or `tea` in the active worktree, so they follow the remote workspace too.

## Building

```sh
npm install --ignore-scripts
npm run build
```

Then click **Reload** in the Muxy Extensions modal.
