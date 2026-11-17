# Dev harness

Runs the panel and the editor tab in a normal browser, without Muxy, against
`mock-muxy.js`: a stand-in `window.muxy` with a synthetic ~20k-entry repository
(a wide `node_modules`, 40 source folders, a 3,000-line `src/big.js` whose
HEAD version differs at the top and bottom), simulated IPC latency, absolute
`file.changed` payloads like the real host, and the permission errors the host
returns for undeclared permissions.

## Interactive

```bash
npm run dev
# http://localhost:5173/dev/panel.html
# http://localhost:5173/dev/editor.html?surface=tab&file=src/big.js
```

Query parameters: `latency=<ms>` (default 2), `theme=light`,
`surface=tab&file=<path>` for the editor, `pane=<id>` to simulate a second tab.

`window.__mock` exposes the in-memory files (`files`, `dirs`), `emit(name,
payload)`, `changed(rel)`, `flood(count)` (an `npm install`-style burst of
`file.changed` events), `setData(data)`, `focus(bool)`, and `opened` (tabs the
page asked to open).

## Benchmarks

Benchmark production bundles, not the dev server:

```bash
npm run bench:build                     # -> bench-dist/
npx vite preview --outDir bench-dist --port 4802
```

Then, in the page's console (or `agent-browser eval`):

| Call | Measures |
| --- | --- |
| `__bench.load()` | time to the first tree row / editor line |
| `__bench.expand("node_modules/")` | click-to-children for a 300-entry folder |
| `__bench.walk(500)` | arrowing through the tree, expanding every folder |
| `__bench.scroll()` | frame times scrolling the whole tree |
| `__bench.flood(2000)` | main-thread cost of a `file.changed` burst |
| `__bench.type()` | keystroke-to-frame latency in the editor |

To benchmark with every folder open, seed the panel's memory and reload:

```js
localStorage.setItem(`muxy.files.tree:${__mock.ROOT}`,
  JSON.stringify({ expanded: [...__mock.dirs.keys()].filter(Boolean).map((d) => d + "/") }));
```
