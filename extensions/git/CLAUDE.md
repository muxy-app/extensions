# git

Official Git extension for Muxy. npm + Vite, vanilla JavaScript, plain CSS on
the Muxy scale (no Tailwind).

## Layout

- `panel/index.html` → `src/panel/`: the Source Control panel.
  - `controller.js` owns repository state: one status request in flight,
    bursts coalesced, and nothing re-rendered unless the status changed.
  - Each tab (`changes/`, `history/`, `prs/`, `runs/`) is a view with
    `update(state, prev)`, `show()`, and `hide()`.
  - `ops/` holds user actions.
- `panel/diff-viewer.html` → `src/diff/`: the Changes tab type. Openers reuse
  one tab per kind through `src/shared/diff-tabs.js`.
- `modal/create-pr.html` → `src/create-pr/`. The form is a component that is
  also mounted inline in the Pull Requests tab.
- `modal/pr-browser.html` → `src/pr-browser/`: the `cmd+shift+y` browser. It
  reuses `src/panel/prs/detail.js` and `src/shared/pr-detail.js`.
- Dialogs: `src/shared/popover.js` draws pickers, prompts, and confirmations in
  the page. `setDialogAnchor` routes `ask`, `confirmAction`, and `alertError`
  to it. Don't use `muxy.modal.open` or `muxy.dialog` in pages; they're slow.
- `src/core/`: git I/O (`git.js`), pure parsers (`status.js`, `commits.js`,
  `graph.js`, `remote.js`), and forges (`forge/gh.js`, `forge/tea.js`).
- `src/shared/`: DOM helpers, icons, menu, virtual list, prefs, base CSS.
- `scripts/`: palette `runScript` commands, synchronous, bundled by
  `scripts/build-scripts.mjs`. They may import only pure modules.
- `dev/`: mock `window.muxy` and benchmarks (`dev/README.md`).
- `tests/`: `npm test`.

## Building & editing

Install deps with `npm install --ignore-scripts`, then `npm run build` to produce
`dist/`. After rebuilding, click "Reload" in the Muxy Extensions modal.

## Guides

- Never use code comments. If you see any, remove them.
- Write less code: small components, reusable code.
- Avoid large files.
- Don't patch symptoms; fix the root cause.
- Keep pure logic out of modules that touch `muxy`, and test it.
- Check performance-sensitive changes with the dev harness benchmarks.
