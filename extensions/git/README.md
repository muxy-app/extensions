# Git

Official Git extension for Muxy: source control panel, diff tabs, history,
pull requests, and workflow runs.

## Features

- **Source Control panel** (`cmd+y`)
  - **Changes**: conflicts, staged, and unstaged files as a list or a tree,
    with a filter (`cmd+f`). Click a file to open its diff, and double-click to
    open it in the Files editor.
  - **Keyboard**: arrows to move, `shift` to extend the selection, `space` to
    stage or unstage, `delete` to discard, `enter` to open.
  - **Context menu**: Open Changes, Open File, Reveal in Finder, Copy Path,
    Stage, Discard, Add to .gitignore, and for conflicts Accept Current or
    Accept Incoming.
  - **Commit box**: the draft is kept per worktree, and `cmd+enter` commits
    (`shift+cmd+enter` commits and pushes). With nothing staged it commits all
    changes. The menu has Commit & Push, Commit All, Amend, and Undo Last
    Commit.
  - **Merges, rebases, cherry-picks, and reverts in progress**: a banner with
    Continue and Abort.
  - **Branch and sync**: an instant branch dropdown (cached, searchable) to
    switch, create, or delete branches, including remote ones. Pull, push,
    publish, force push (with lease), and fetch. A quiet background fetch keeps
    ahead/behind counts current. Stash changes and pop, apply, or drop stashes.
  - Confirmations, prompts, and pickers open inside the panel, so nothing waits
    on an app-level dialog.
- **History**: commit graph with ref labels, unpushed commits marked, and an
  Incoming section for upstream commits. Filter by message, author, or hash.
  Right-click a commit to check it out, branch or tag from it, cherry-pick,
  revert, copy its hash, or open it on the remote.
- **Pull Requests**
  - **Current branch card**: merge state, review status, and checks.
  - **Merging**: merge with your chosen method. Merge & Clean Up also deletes
    the branch or removes the worktree.
  - **Other actions**: mark a pull request ready, update its branch, or close
    it.
  - **Creating**: an inline form creates the branch, commits, pushes, and opens
    the pull request.
  - **List**: search it, then click a pull request for details: description,
    labels, merge, review and check status, the checks list, and comments and
    reviews. From there you can merge, check it out here or in a new worktree,
    or view its changes.
- **Runs** (GitHub): workflow runs with re-run, re-run failed jobs, and cancel.
  The list refreshes while runs are in progress.
- **Changes tab**: staged and unstaged diffs side by side or unified, kept up to
  date as files change. Stage, unstage, discard, or open each file from its
  header. Commit and pull request diffs show the message or description on top.
  One tab is reused per kind, so browsing history doesn't pile up tabs.
- **Pull request browser** (`cmd+shift+y`): search open pull requests, with
  full details beside the list. `enter` checks one out, and `shift+enter`
  creates a worktree.
- **Palette commands**: Switch Branch…, Pull Requests…, Create Pull Request…,
  and Open Changes.

## Pull request backends

The forge is detected from the repository's `origin` remote:

- **GitHub / GitHub Enterprise** use the [`gh`](https://cli.github.com) CLI.
- **Forgejo / Gitea** use the [`tea`](https://gitea.com/gitea/tea) CLI when the
  remote host matches one of your `tea login list` entries.

Plain source control needs only `git`.

## Remote workspaces

Git work runs through Muxy's own Git integration (`muxy.git`) and `muxy.exec`
in the active worktree, so it follows remote (SSH) projects too.

## Development

```sh
npm install --ignore-scripts
npm run build      # dist/, then Reload in the Extensions modal
npm test           # unit tests
npm run dev        # dev harness: see dev/README.md
```
