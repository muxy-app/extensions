# Git

Official Git extension for Muxy — source control panel, branch switching,
diff viewer, and pull requests.

## Features

- **Source Control panel** (`cmd+y`) — staged/unstaged changes, stage,
  commit, and discard.
- **Branch switcher** — switch and create branches from the status bar.
- **Diff viewer** — inline file diffs.
- **Pull Requests** — browse PRs and view the current PR for the branch.
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

## Building

```sh
npm install --ignore-scripts
npm run build
```

Then click **Reload** in the Muxy Extensions modal.
