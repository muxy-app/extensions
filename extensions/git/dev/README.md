# Dev harness

Runs the panel, the diff tab, and the Create Pull Request form in a normal
browser against `mock-muxy.js`, a stand-in `window.muxy` with a synthetic
repository and simulated host latency.

```bash
npm run dev
# http://localhost:5173/dev/panel.html
# http://localhost:5173/dev/diff.html
# http://localhost:5173/dev/create-pr.html
# http://localhost:5173/dev/pr-browser.html
```

Query parameters: `changes=<n>` (default 40; over 4096 exercises the porcelain
fallback), `commits=<n>`, `latency=<ms>`, `theme=light`, `conflicts=1`,
`op=merge`, `nopr=1` (no pull request for the branch), `data=<json>` for the diff tab (for example
`{"source":"commit","hash":"abc"}`).

`window.__mock` exposes `state`, `calls` (host calls by name), `seed(n)`,
`changed(path)`, `flood(n)` (a burst of `file.changed` events) and `opened`
(tabs the page asked to open).

## Benchmarks

In the panel's console: `__bench.load()`, `__bench.refresh(4000)`,
`__bench.flood(2000)`, `__bench.scroll()`.
