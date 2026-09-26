# cheatsheets

`⌘⌃K` → type a command name → the tldr page, beautifully rendered, one-click
copy on every example — without leaving Muxy or losing your terminal. man
pages too, and a status-bar book icon for browsing any time.

## What it does

- **Palette lookup** (`⌘⌃K`, command *Cheatsheets: Look Up Command…*) — an
  omnibox-style modal over every known tldr page and man page, rendered
  inline on selection. Type `open(2` to narrow to a man section. With
  **Settings → Terminal → Auto-copy terminal selection** enabled, highlighted
  text pre-fills the search box.
- **Search contents** — a checkbox next to the search box in both the lookup
  modal and the popover. Unchecked (the default) the box filters page *names*
  (plus man's one-line descriptions); checked, it searches the *text inside*
  pages — `tldr --search` for tldr, and a `grep` over the manpath for man. It
  needs 3+ characters and waits for a pause in typing, since the man side
  shells out across the whole man tree (~1s here).
- **Keyword search** (*Cheatsheets: Search tldr by Keyword…*) — full-text
  keyword search across tldr pages via `tldr --search`.
- **Status-bar browser** — the book icon opens a popover with search, recents,
  favorites, and inline rendering.
- **Settings** — the ⚙ button (popover footer, lookup hintbar) opens a shared
  settings view: whether **Search contents** starts ticked, and the tldr
  platform, source order, all-platforms toggle and cache controls.
- **Pin as tab** — any page can be kept open as a regular Muxy tab.
- **tldr rendering** — description, examples as copy-ready cards,
  `{{placeholder}}` highlighting. Press `1`–`9` to copy an example; hold `⌥`
  to strip the `{{ }}` placeholders on copy.
- **man rendering** — mandoc HTML (sanitized) with a section outline in the
  tab view, or cleaned plaintext where mandoc is unavailable. Cross-references
  like `tar(1)` are clickable.

## Sources

Three sources behind one interface, tried in your configured order
(default `tldr → man`):

1. **tlrc** — the official Rust tldr client (`brew install tlrc`; Homebrew's
   `tldr` formula is tlrc). Used for listing, pages, and keyword search, always
   with `--offline` so lookups never block on a network refresh.
2. **man** — always present on macOS and most remotes. Listing via `apropos`
   (or a `manpath`-based fallback when the whatis DB is empty), rendering via
   `mandoc -T html`, falling back to `man -P cat`.
3. **GitHub fallback** — when tlrc is missing or has no page, pages are
   fetched from tldr-pages on GitHub, so the extension works with **nothing
   installed**. The page index and the last 50 fetched pages are cached in
   extension storage.

On a remote (SSH) workspace all commands run on the remote host, so man pages
are the remote's — which is what you want. The HTTP fallback always runs on
the Mac, so tldr keeps working even when the remote has no tlrc.

Note for the zero-install path: the palette picker's tldr list comes from the
page index, which is first downloaded when you open the popover or a tldr
page — open the popover once and the picker fills in.

## Permissions

| Permission | Why |
| --- | --- |
| `commands:exec` | The whole point of the extension: it reads pages from the CLIs you already have. `tldr` for pages, listing, keyword search and cache updates; `man`, `mandoc` and `apropos` for man pages; `manpath` + `zgrep`/`grep` for **Search contents**; `pbpaste` to pre-fill the search box from a terminal selection. Every command is invoked as an argv array, never a shell string with user input spliced in, so a search term can never be interpreted as shell syntax. Muxy prompts for each command separately the first time it runs. |
| `storage:read` / `storage:write` | Settings, favorites, recents, the cached tldr page index, and the last 50 pages fetched over HTTP. All of it is this extension's own data; nothing is read from or written to your project. |
| `tabs:write` | "Pin as tab" — keeping a page open as a regular Muxy tab, and setting that tab's title. |
| `panels:write` | Required by the `openModal` command action that renders the ⌘⌃K lookup window. |

Network access needs no manifest permission: pages are fetched from
`raw.githubusercontent.com`/`github.com` via `muxy.http.fetch`, and Muxy asks for
per-host consent on the first request. Nothing is ever sent anywhere — the only
outbound traffic is a GET for a tldr page or the page index.

## The hotkey

`⌘⌃K` is a manifest `defaultShortcut` bound to a native `openModal` action, so it
works with **no background script involved**. Rebind or clear it under Settings →
Keyboard Shortcuts → App Shortcuts.

**Do not move it to a runtime `muxy.shortcuts` binding.** That was tried and
reverted: the background host has neither `muxy.storage` nor `muxy.shortcuts`,
and rejects `command.<id>` subscriptions for ids that are not declared
`commands` — so the binding never registered and the extension was left with no
hotkey and no visible error. See the header comment in `background.js` for the
exact log output; the published API reference overstates what that context has.

## First-run consents

Muxy prompts once per command (choose "Allow & remember"); each prompt fires
only when the feature is first used, never at install:

| Consent | When |
| --- | --- |
| `tldr` | first lookup / search / cache update |
| `apropos` | first time the picker or popover lists man pages |
| `man` | first man page opened |
| `mandoc` | first man page rendered |
| `manpath …` shell string | only if `apropos` returns nothing |
| `manpath` | first **Search contents** query (to find the man roots to grep) |
| `zgrep` (or `grep`) | first **Search contents** query |
| host `github.com` / `objects.githubusercontent.com` | only if the HTTP fallback fetches the page index |
| host `raw.githubusercontent.com` | only if the HTTP fallback fetches a page |

## Building

```sh
npm install
npm run build     # vite build + background bundle + manifest copy → dist/
npm test          # parser / sanitizer / ref-codec unit tests
```

Load the folder via **Load Unpacked** in Muxy's Extensions modal; after a
rebuild, click **Reload** there to pick up changes.
