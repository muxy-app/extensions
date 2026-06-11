# Web Browser

A lightweight web browser tab for Muxy. Browse documentation, preview a local
dev server, or search the web without leaving your workspace.

- A **Web Browser** tab type with an address bar, back/forward/reload, and
  per-tab history that survives project switches
- A palette command: **Web Browser: Open**
- A right-side status bar launcher: **Browser**

Type a URL to navigate, or anything else to search with DuckDuckGo. Bare hosts
(`localhost:3000`, `example.com`) get `https://` automatically.

Pages render in a sandboxed iframe, so sites that forbid embedding
(`X-Frame-Options` / CSP `frame-ancestors`) will refuse to load.

## Annotations

Toggle the **pin** button in the toolbar to enter annotation mode, then
click anywhere on the page to drop a numbered pin and attach a comment.
Click an existing pin to edit, ESC closes the popover.

The **copy** button next to it exports all pins on the current URL as
Markdown (URL, viewport size, per-pin position + comment), ready to paste
into an agent prompt.

Pins are stored per URL in `.muxy/web-browser-comments.json` at the
worktree root, so they're versionable and survive project switches. The
first save triggers a one-time `files:write` consent prompt. If the
file API isn't available, pins fall back to `localStorage`.

Pins live on an overlay above the iframe — they don't bind to DOM
elements, so the only requirement is that the page renders at a stable
viewport size. The annotation feature works on any URL, including
cross-origin sites where DOM access is impossible.

## Permissions

- `tabs:write` — required by the `openTab` command action that opens the
  browser tab from the palette and the status bar item.
- `files:read` / `files:write` — load and persist annotations to
  `.muxy/web-browser-comments.json`.
