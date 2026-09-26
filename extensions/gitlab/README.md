# GitLab

Browse and manage GitLab issues and merge requests for the current project
without leaving Muxy — list, filter, view details, comment, edit, label,
approve, merge, and check out, all from a docked panel.

Inspired by the [GitHub extension](https://github.com/muxy-app/extensions/tree/main/extensions/github)
for Muxy (Issues and Pull Requests on GitHub); this extension brings the same
list-filter-detail-act flow to GitLab issues and merge requests.

Works with **gitlab.com and self-managed instances**: the instance and the
project are both read from the project's git remote, so switching between a
gitlab.com repo and a company install needs no configuration in the panel.

## Features

- **Issues & Merge Requests** — switch between the two, filter by
  Open / Merged / Closed / All, search the current list, and (for merge
  requests) toggle **Mine** to show only the ones you authored.
- **Detail view** — description (rendered Markdown), labels with their real
  colors, assignees, reviewers, milestone, pipeline status, approvals, changed
  file count, and comments.
- **Merge blockers explained** — when a merge request can't be merged, the
  panel says why (draft, pipeline still running, unresolved discussions,
  conflicts, missing approvals, …) rather than just failing on click.
- **Actions** — comment, edit, add/remove labels and assignees, approve or
  revoke approval, merge (merge / squash / rebase, optionally when the pipeline
  succeeds), mark ready/draft, check out locally, close/reopen, and create new
  issues and merge requests.
- **Project-aware** — a project picker lets you point the panel at any open
  project; "Current project" follows the active project automatically.
- **Guided setup** — offers to install the `glab` CLI via Homebrew if it isn't
  found, and shows the exact `glab auth login --hostname …` command for the
  instance this project's remote points at.

## Requirements

Uses the [`glab`](https://gitlab.com/gitlab-org/cli) CLI, authenticated once per
instance:

```sh
glab auth login                                  # gitlab.com
glab auth login --hostname gitlab.example.com    # self-managed
```

Reads go through `glab api` (the GitLab REST API) pinned to the host from the
git remote; writes go through glab's own subcommands pinned to the project with
`-R`. Nothing depends on which instance glab happens to consider the default.

## Permissions

- `commands:exec` — runs `glab` (plus `git` to read the remote, and `open` to
  open items in the browser).
- `projects:read` — lists open projects for the project picker and reacts to
  `project.switched`.
- `panels:write` — registers the docked GitLab panel.

## Building

```sh
npm install
npm run build
npm test
```

Then click **Reload** in the Muxy Extensions modal.
