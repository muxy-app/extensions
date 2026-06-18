# Muxy Plex Dashboard

A small Muxy extension that gives Plex Media Server admins a right-side sidebar
to monitor playback, stop streams (optionally with a message), and see essential
server stats — without leaving Muxy.

## Permissions

This extension requests the minimum it needs:

- **`commands:exec`** — to shell out to `/usr/bin/curl` for every HTTP call
  (plex.tv OAuth and Plex Media Server endpoints) and to `/usr/bin/open` to
  launch the user's browser during sign-in. Running curl in the host process
  avoids WebView CORS and keeps the entire network surface auditable in source.
- **`panels:write`** — to declare the right-side sidebar panel.

The Plex auth token and the stable client identifier are stored in the panel's
`window.localStorage` (keys `plex-dashboard:token` and `plex-dashboard:prefs`). No files
are written outside the WebView's storage directory, and no `files`, `git`, or
background process permissions are requested. Polling pauses when the panel is
not visible.

## Setup

1. Click the **Plex Dashboard** icon at the right of Muxy's status bar (or run
   **Plex Dashboard: Toggle** from the command palette) to open the sidebar.
2. Click **Sign in with Plex**. Your browser opens
   `https://app.plex.tv/auth` with a pre-filled code. Sign in to your Plex
   account and approve.
3. If you own multiple Plex servers, pick the one you want to monitor.
4. The dashboard shows server identity, active sessions, active transcodes, and
   essential server stats (host CPU/RAM, aggregate bandwidth). Use the **Stop**
   button on a session to terminate it
   (optionally with a message shown to the viewer).
5. Use the sign-out header button to remove the stored token.

Only servers you **own** are listed — terminating sessions requires admin
scope on the server.

## Development

```bash
npm install
npm run dev     # vite build --watch into dist/
npm run build   # vite build into dist/
```

Then load the extension in Muxy's Extensions modal pointed at this directory.

## What's intentionally out of scope (v1)

- LAN mDNS server discovery (we use the plex.tv resources API instead).
- Bandwidth/transcoder history charts — current snapshot only.
- Notifications when a new session starts.
- Shared (non-owned) servers — admin endpoints reject non-owner tokens.
