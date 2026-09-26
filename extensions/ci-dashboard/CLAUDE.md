# ci-dashboard

Muxy extension. npm + Vite project.

## Layout

- `package.json` — npm manifest; Muxy fields live under the `muxy` key.
- `index.html` + `src/` — the panel.
  - `model.js` — the normalized `Run` / `Job` shape every provider maps onto,
    plus status normalization and duration/since-green helpers. Nothing above
    this layer knows which CI a run came from.
  - `logs.js` — pure log analysis: ANSI stripping, `gh`'s tab-separated column
    format, the failure excerpt, and the `file:line` "likely cause".
  - `providers/` — one module per CI, plus `index.js` which fans out and
    collects per-source errors instead of throwing.
  - `views/` — rendering; `state.js` holds shared state and the `nav` hooks that
    keep the module graph acyclic (views never import `main.js`).
- `test/` — `node --test`. `fixtures/` holds JSON recorded from the real `gh`
  CLI; `cctray-http.test.mjs` runs curl against a real local HTTP server.

## Things that bit, and must not regress

- **Durations are never invented.** CCTray publishes only `lastBuildTime` (when
  a build last *finished*), so its runs set `durationKnown: false` rather than
  letting `durationMs` derive a bogus `0s` — or, for a running build, measure
  from the *previous* build's end. GitHub also stamps some skipped jobs as
  completing *before* they started, so negative spans are discarded.
- **`updatedAt` is not a finish time** while a GitHub run is in flight; treating
  it as one freezes the ticking duration.
- **The ANSI regex must require the ESC byte.** Without it, it also eats
  GitHub's own `##[error]` markers, which are the strongest failure signal.
- **A `conclusion` beats a `status`** — GitHub reports `status: "completed"`
  alongside the conclusion that says how it actually went.
- **One failing source must not blank the panel.** `providers.loadAll` collects
  errors per source and renders them as a strip above whatever did load.

## How it talks to build servers

`gh` and `glab` are shelled out to so the user's existing CLI auth is reused and
this extension holds no tokens. CCTray goes through `curl`, not
`muxy.http.fetch`, because `muxy.http` blocks private/loopback hosts and most
build servers are internal. Config lives in `muxy.storage` keyed by repository
root, so it follows the repo rather than the picker's cwd.

## Building & editing

`npm install`, then `npm run build` to produce `dist/`. After rebuilding, click
"Reload" in the Muxy Extensions modal. `npm test` runs the unit and curl
integration tests.

## Conventions

Follow the Muxy extension guidance before changing the manifest or the UI:
<https://muxy.app/llms.txt> (append `/plain` to any docs URL for raw Markdown).
In short: no hex literals for chrome — every color is a `var(--muxy-…)`; spacing,
font, icon and radius values come from the scale at the top of `src/style.css`;
declare only the permissions actually used.
