# GitHub

Browse and manage GitHub Issues and Pull Requests for the current project
without leaving Muxy — list, filter, view details, comment, edit, label,
review, merge, and checkout, all from a docked panel.

## Features

- **Issues & Pull Requests** — switch between the two, filter by
  Open / Closed / All, and search the current list.
- **Detail view** — full description (rendered Markdown), labels,
  assignees, milestone, CI checks, diff stats, and comments.
- **Actions** — comment, edit, add/remove labels and assignees, review,
  merge, mark ready/draft, checkout locally, close/reopen.
- **Project-aware** — a project picker lets you point the panel at any
  open project; "Current project" follows the active project automatically.
- **Guided setup** — offers to install the `gh` CLI via Homebrew if it
  isn't found.

## Requirements

Uses the [`gh`](https://cli.github.com) CLI, authenticated once via
`gh auth login`.

## Permissions

- `commands:exec` — runs `gh` (and `open`, to open items in the browser).
- `projects:read` — lists open projects for the project picker and reacts
  to `project.switched`.
- `panels:write` — registers the docked GitHub panel.

## Building

```sh
npm install
npm run build
```

Then click **Reload** in the Muxy Extensions modal.
