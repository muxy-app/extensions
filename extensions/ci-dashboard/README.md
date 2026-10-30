# CI/CD Dashboard

A unified CI dashboard for the current project — pipelines, jobs, why a build
broke, and what changed since it was last green, in a docked panel.

The point is that it is **project-aware** rather than another generic CI UI: it
reads what CI the repository actually uses, groups everything into one list, and
follows the branch you have checked out.

## What it shows

- **Pipelines** — status, workflow, branch, duration and age, newest first, with
  a per-job tally. A running build pulses; the panel re-checks every 20s while
  anything is still in flight (and stops when it isn't, or when the panel is
  hidden).
- **Jobs** — per-job status, stage, and duration, with a retry button on the
  ones that failed.
- **Why it broke** — the failed step's log, trimmed to the part that matters,
  plus a **likely cause** (`src/auth/session.ts:84`) extracted from the first
  real source location in the failure, and a failure count when the runner
  states one (`14 reported`).
- **What changed since it was last green** — the commits between the newest
  successful pipeline on this branch and the one that failed.
- **Environments** — the latest deployment per environment and its state.
- **Open in browser** — every pipeline, job and environment links out.

## Sources

Sources are configured **per repository** and loaded independently — one
unreachable build server never blanks out the rest of the dashboard.

| Source | Detected from | Reads via | Jobs | Logs | Retry / cancel | Environments |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub Actions | `.github/workflows/*.yml` | `gh` CLI | ✅ | ✅ | ✅ | ✅ |
| GitLab CI | `.gitlab-ci.yml` and friends (below) | `glab` CLI | ✅ | ✅ | ✅ | ✅ |
| CCTray feed | you supply the URL | `curl` | — | — | — | — |

GitHub Actions and GitLab CI are picked up automatically and need no
configuration beyond the CLI you have already authenticated (`gh auth login` /
`glab auth login`). Neither is required — the panel works with only a CCTray
monitor configured.

### Where GitLab CI is looked for

GitLab defaults to `.gitlab-ci.yml` in the repository root, but a project can
point at **any path**, at another project, or at an external URL. So detection
checks the common locations:

- `.gitlab-ci.yml` / `.gitlab-ci.yaml` (root — the default)
- `.gitlab/.gitlab-ci.yml` / `.gitlab/.gitlab-ci.yaml`
- any `*.yml` under `.gitlab/ci/` or `.gitlab-ci/` (a config split into includes)

A `.gitlab/` directory holding only issue or merge-request templates does not
count. GitHub is simpler — workflows only ever run from `.github/workflows`, so
there is nothing else to check.

Because that list can never be complete, **detection is only a suggestion**: the
Sources view always offers "Not detected — add anyway" for any native provider
it did not find. The provider reads pipelines from the API, so a custom config
path, a config in another project, or a mirrored repository all still work.

### Anything else: CCTray

Nearly every build server publishes a **CCTray** feed, which is what makes the
generic path work: **TeamCity**, Jenkins, GoCD, Bamboo, CruiseControl. Add the
feed URL and the panel lists the projects it reports so you can tick the ones
belonging to this repository — that is how one server-wide feed is narrowed to
your project. Add several monitors when different branches build under
different URLs.

Conventional paths, offered as hints when the matching config is detected:

| Server | Path |
| --- | --- |
| TeamCity | `/app/rest/cctray/projects.xml` |
| Jenkins | `/cc.xml` |
| GoCD | `/go/cctray.xml` |

A repository holding a `Jenkinsfile`, `.teamcity/`, `.circleci/`,
`azure-pipelines.yml`, `.drone.yml` or `.buildkite/` is recognized and the
matching hint is shown, even though there is no local CLI to read it with.

**Authentication** — none, bearer token, custom header, basic auth, or a
`curl --config` file. Prefer the config file for anything sensitive: the
credential stays in a file you own instead of Muxy's extension store, which is
plain JSON. The panel labels any monitor whose secret it stores. Self-signed
certificates are opt-in per monitor.

Requests go out through `curl` rather than `muxy.http.fetch` on purpose:
`muxy.http` blocks private and loopback hosts, and most build servers worth
watching live on an internal network.

### Not yet supported

Formats beyond CCTray — Jenkins' JSON API, the TeamCity REST API, CircleCI,
Buildkite and Azure Pipelines — would each need their own provider. The
provider registry in `src/providers/` is the seam for adding one; say the word
and it can be built.

## Branch filter

The picker starts on the branch you have checked out and lists the rest, plus
"All branches". GitHub Actions and GitLab CI filter server-side; a CCTray feed
is filtered locally, and entries whose branch cannot be determined are always
shown rather than silently hidden.

## Requirements

- [`gh`](https://cli.github.com) for GitHub Actions, [`glab`](https://gitlab.com/gitlab-org/cli)
  for GitLab CI — only the ones you actually use.
- `curl` (ships with macOS) for CCTray monitors.

## Permissions

- `commands:exec` — runs `gh`, `glab`, `curl` (to the URLs you configure),
  `git log` for the since-green commit range, and `open` for browser links.
- `git:read` — the current branch and branch list.
- `files:read` — detects CI configuration checked into the repository.
- `storage:read` / `storage:write` — per-repository source configuration.
- `projects:read` — the project picker, and reacting to `project.switched`.
- `panels:write` — registers the docked panel and its header buttons.

## Building

```sh
npm install
npm run build
npm test
```

Then click **Reload** in the Muxy Extensions modal.
