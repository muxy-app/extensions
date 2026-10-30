# gitlab

Muxy extension. npm + Vite project.

## Layout

- `package.json` — npm manifest. Identity (`name`, `version`) is at the top
  level; all Muxy fields live under the `muxy` key.
- `vite.config.js` — builds to `dist/`, the directory Muxy installs.
- `index.html` + `src/` — the panel.
  - `glab.js` — everything that shells out: git remote parsing, `glab api`
    reads, glab subcommand writes, error classification.
  - `state.js` — shared panel state and the `nav` hooks that keep the module
    graph acyclic (views/actions never import `main.js`).
  - `views.js` — rendering; `actions.js` — the action toolbelt and its panels.
- `test/` — `node --test` over the pure helpers (no DOM).

## How it talks to GitLab

Reads use `glab api <endpoint> --hostname <host>`, so the shapes are GitLab's
documented REST responses. Writes use glab subcommands with `-R <web_url>`.
Both the host and the project come from the git remote of the selected project,
which is what makes self-managed instances work without configuration.

Two shape differences matter: list endpoints return label **objects** (via
`with_labels_details`) while single-item endpoints return label **names** —
`views.normalizeLabels` reconciles them against the project's label list. And
`glab mr merge` defaults `--auto-merge` to true, so an immediate merge has to
pass `--auto-merge=false` explicitly.

`ensureProject()` also resolves the signed-in user for the current host
(`GET /user`) into `state.currentUser`, alongside labels and members — it's
what the MR list's "Mine" toggle filters against. Like labels/members, a
failure there is non-fatal and just leaves the toggle unable to match anyone.

## Parity with the GitHub extension

This panel is a deliberate port of `extensions/github` (same layout, same
`.seg`/`.listbar`/`.detail`/`.toolbelt` CSS, same panel/command/topbar shape
in the manifest), adapted to GitLab's REST API and `glab` CLI, then extended
with GitLab-specific behavior the GitHub side has no equivalent for: a real
label-color/approvals/pipeline/weight model, self-managed instance support
via the git remote, and per-status merge-blocked explanations. When adding a
feature to one side, check whether the other should get it too.

## Building & editing

`npm install`, then `npm run build` to produce `dist/`. After rebuilding, click
"Reload" in the Muxy Extensions modal. (`npm run dev` runs Vite's dev server.)

## Conventions

Follow the Muxy extension guidance before changing the manifest or the UI:
<https://muxy.app/llms.txt> (append `/plain` to any docs URL for raw Markdown).
In short: no hex literals for chrome — every color is a `var(--muxy-…)`; spacing,
font, icon and radius values come from the scale declared at the top of
`src/style.css`; declare only the permissions actually used.
