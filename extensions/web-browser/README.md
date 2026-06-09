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

## Permissions

- `tabs:write` — required by the `openTab` command action that opens the
  browser tab from the palette and the status bar item.
