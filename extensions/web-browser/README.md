# Web Browser

Open web pages without leaving your workspace.

- A **Web Browser** tab with an address bar and your recent pages
- A palette command: **Web Browser: Open**
- A right-side status bar launcher: **Browser**

Type a URL, or anything else to search with DuckDuckGo. Bare hosts
(`localhost:3000`, `example.com`) get `https://` automatically.

Pages open in Muxy's built-in browser. Extension pages can't show other sites
themselves, since Muxy blocks them from loading in a page or frame. Where Muxy
has no built-in browser, such as Muxy 2, web pages open in your default browser
instead.

## Permissions

- `tabs:write` — required by the `openTab` command action that opens the
  browser tab from the palette and the status bar item.
- `browser:write` — opens pages in Muxy's built-in browser.
- `commands:exec` — runs `/usr/bin/open <url>` for `http` and `https` pages
  when Muxy has no built-in browser. Muxy asks before the first one.
