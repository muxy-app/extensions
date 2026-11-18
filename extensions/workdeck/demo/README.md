# Demo harness

Renders the extension's real pages with **invented data** so README screenshots show no personal projects, repositories,
issues or chats. It is development tooling; the extension itself never loads anything from this folder.

- `muxy-stub.js` — a fake `window.muxy` (projects, tabs, agents, storage, and canned `gh` / `git` / Linear / `muxy` /
  `kakao-linear` responses for a made-up company "Acme").
- `loader.html` — loads a real page (`?page=tab/issues.html`) with the stub in front of it, in English.
- `scenario.js` — scripted clicks (open a detail, switch tabs, pick a chat room, ...), chosen with `?scenario=`.
- `shell.html` — a mock window (sidebar + tab or modal) used for the screenshots.
- `shoot.sh` — serves this extension folder on localhost and saves 1600×1000 PNGs to `assets/screenshots/` with
  headless Google Chrome: `sh demo/shoot.sh`.
