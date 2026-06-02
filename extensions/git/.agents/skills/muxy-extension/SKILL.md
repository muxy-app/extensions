---
name: muxy-extension
description: Best-practice guide for authoring a Muxy extension — how it should look and behave so it reads as a native part of the app. Covers theming (follow the theme, never hardcode colors), the sizing scale, and which surface to use. Mechanics (manifest fields, permissions, the window.muxy API) live in the linked docs.
---

# Muxy Extension Guide

A Muxy extension is an npm + [Vite](https://vitejs.dev) project in `~/.config/muxy/extensions/<name>/`: source under `src/`, `vite build` emits `dist/`, and Muxy installs and reads `dist/`. The manifest is the `"muxy"` object in `package.json`.

**This skill is the guidance layer — how an extension should look and behave.** For the API and manifest mechanics (every field, the permission strings, the full `window.muxy` surface, events, scripts), read the reference docs:

> **<https://github.com/muxy-app/muxy/tree/main/docs/extensions>**

The goal of everything below: an extension should be indistinguishable from a native Muxy surface. Match the theme and match the scale, and it will be.

## Pick the right surface

- **Showing something to the user** → a **UI page** (tab, panel, or popover). Page scripts get the full `window.muxy` API.
- **Reacting to events or running shell commands headlessly** → a **`background.js`** script. Most extensions don't need one.
- **One-shot logic from the palette** → a **`runScript`** command, not a hidden tab.

Don't open a hidden tab to run logic, and don't put event-driven work in tab JS where closing the tab loses it.

## Theme — follow it, never hardcode

Muxy ships paired light/dark themes and a user-chosen accent. Every extension webview inherits CSS custom properties on `document.documentElement` that track the live theme and update automatically when the user switches it.

**Rules:**

1. **No hex literals for chrome.** Use `var(--muxy-…)` for every color. The only exception is decorative art meant to be theme-independent.
2. **The variables already invert** for light/dark — never sniff the color scheme to pick a color. Only branch on `muxy.theme.colorScheme` for things a variable can't express (e.g. swapping a logo image).
3. **`--muxy-accent` is the only saturated color.** Use it sparingly — primary action, focus ring, one key number — so it stays distinctive. Text *on* an accent fill should be `--muxy-background` to stay legible in both themes.
4. **Depth comes from `--muxy-surface` + `--muxy-border` + `--muxy-hover`,** not from new colors. Cards, inputs, code blocks, and buttons all share the one surface color.
5. **Re-read the theme for JS-drawn color.** Canvas/SVG that doesn't pick up CSS variables must redraw in `muxy.onThemeChange(theme => …)`.
6. **Popovers leave the body transparent** (`body { background: transparent; }`) — they sit over native macOS popover material that is already light/dark-aware. Tabs and panels *do* paint `--muxy-background` on the body.

**The variables (the complete injected set):**

| Variable | Use for |
| --- | --- |
| `--muxy-background` | Page background |
| `--muxy-foreground` | Primary text |
| `--muxy-foreground-muted` | Secondary text, labels, captions |
| `--muxy-surface` | Cards, inputs, code blocks, buttons |
| `--muxy-border` | 1px borders and dividers |
| `--muxy-hover` | Hover state for buttons / rows |
| `--muxy-accent` | Primary action, links, focus rings |
| `--muxy-accent-soft` | Translucent accent for badges/highlights |
| `--muxy-diff-add` / `--muxy-diff-remove` / `--muxy-diff-hunk` | Diff / success / error / hunk colors |
| `--muxy-topbar-height` | The app's tab-bar height (see Sizing) |

(`muxy.theme.colorScheme` gives `"light"`/`"dark"` in JS; there is no `--muxy-color-scheme` CSS var.)

## Sizing — match the app's scale

Muxy's native views are built from one scale of values, and **all of them scale with the user's interface-scale setting** (Settings → Interface). Pick from this scale rather than inventing numbers, so your surface tracks scale changes the way native views do. These are the base (100%) values in px:

**Spacing** (padding, `gap`, margin) — `2 · 4 · 6 · 8 · 10 · 12 · 16 · 20 · 24 · 32`. No in-between values. Panel rows and content pad `10px` left/right; an icon-and-label gap is `8px`; adjacent icon buttons sit `4px` apart.

**Font sizes** — `10` caption · `11` footnote/section labels (often uppercased) · **`12` body** (paths, row text) · `13` controls · **`14` titles** (weight 600) · `16`+ headings. Body is `12`, not `13`. Use the system font for UI; `"SF Mono", Menlo, monospace` for code, counts, and hashes.

**Icons** — `12`–`14px` glyphs at **weight 600** (a thinner default weight is the most common reason an extension's icons look foreign). Custom SVG strokes are `1.5px`, round caps/joins.

**Controls** — an icon button is a **`24×24` hit target** wrapping a `13`–`14px` glyph; text buttons are `28px` tall with `10px` horizontal padding.

**Radii** — `4` chips/badges · `6` buttons/inputs · `8` cards/panels · `10` large containers. Buttons are `4`–`6`, not `5`.

**Topbar height is the exception — never hardcode it.** It scales with interface scale and is injected pre-scaled as `--muxy-topbar-height`. A tab fills its whole region, so render your own topbar to match native tabs (so split panes line up): use that variable for the height and keep `box-sizing: content-box` so the 1px `border-bottom` lands on the same line as native tabs. Omit the topbar for edge-to-edge content.

Declare the scale once at the top of your stylesheet and reference it everywhere, so there are no stray magic numbers:

```css
:root {
  --s1:2px; --s2:4px; --s3:6px; --s4:8px; --s5:10px;
  --s6:12px; --s7:16px; --s8:20px; --s9:24px; --s10:32px;
  --font-caption:10px; --font-footnote:11px; --font-body:12px;
  --font-emphasis:13px; --font-title:14px;
  --icon-sm:12px; --icon:14px; --control:24px;
  --radius:6px; --radius-card:8px; --row-height:34px;
}
```

## Behavior

- **Least privilege.** Declare a permission only when you add the call that needs it.
- **Make hover and active states visible** in both light and dark — `background: var(--muxy-hover); border-color: var(--muxy-accent);` is the standard pattern.
- **Respect `prefers-reduced-motion`** — Muxy users opt into Reduce Motion at the OS level; avoid long transitions, large translations, autoplay.
- **No hardcoded `~/.config/muxy` paths** from inside the extension — rely on the working directory Muxy sets, or pass `cwd` to `exec`.

## Checklist

- [ ] Every color is `var(--muxy-…)`; `muxy.onThemeChange` wired for any JS-drawn color.
- [ ] Spacing, font, icon, control, and radius values come from the scale above — no off-ramp numbers (rows pad `10px`, body is `12px`, icons `12`–`14px` at weight 600).
- [ ] Tab topbar uses `--muxy-topbar-height` with `box-sizing: content-box`.
- [ ] Hover/active states are visible in both themes.
- [ ] `permissions` declares only what is used.
- [ ] Event-driven work is in `background.js`, not tab JS. No background script unless events or background `exec` are needed.
- [ ] Built with `npm run build`, then **Reload** in the Extensions modal (a Reload alone won't pick up unbuilt source).


```json
// package.json
{
  "name": "hello-world",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "devDependencies": { "vite": "^5.0.0" },
  "muxy": {
    "description": "Minimal Muxy extension",
    "permissions": ["tabs:write"],
    "tabTypes": [
      { "id": "main", "title": "Hello", "entry": "tabs/index.html" }
    ],
    "commands": [
      {
        "id": "open",
        "title": "Hello World: Open",
        "action": { "kind": "openTab", "tabType": "main" }
      }
    ]
  }
}
```

```html
<!-- src/tabs/index.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="topbar">
    <span class="title">Hello</span>
    <span class="actions"><button id="say">Toast</button></span>
  </header>
  <main class="content">
    <h1>Hello, <span id="who">world</span>!</h1>
  </main>
  <script>
    document.getElementById('who').textContent = muxy.extensionID;
    document.getElementById('say').addEventListener('click', () =>
      muxy.notifications.notify({ title: 'Hello', body: `theme: ${muxy.theme.colorScheme}` })
    );
  </script>
</body>
</html>
```

```css
/* src/tabs/styles.css */
body {
  margin: 0; display: flex; flex-direction: column; height: 100vh;
  font: 13px -apple-system, system-ui, sans-serif;
  background: var(--muxy-background);
  color: var(--muxy-foreground);
}
.topbar {
  box-sizing: content-box;
  height: var(--muxy-topbar-height);
  display: flex; align-items: center; gap: 8px; padding: 0 12px;
  background: var(--muxy-background);
  border-bottom: 1px solid var(--muxy-border);
  flex: 0 0 auto;
}
.topbar .title   { color: var(--muxy-foreground); font-weight: 600; }
.topbar .actions { margin-left: auto; display: flex; gap: 4px; }
.content { flex: 1; overflow: auto; padding: 24px; }
h1 { font-size: 18px; color: var(--muxy-accent); }
button {
  background: var(--muxy-surface);
  color: var(--muxy-foreground);
  border: 1px solid var(--muxy-border);
  border-radius: 5px;
  padding: 6px 10px;
}
button:hover { background: var(--muxy-hover); border-color: var(--muxy-accent); }
```

> Note: `muxy.notifications.notify` requires `notifications:write`. Add it to `permissions` if you use it.

## End-to-end example (popover)

A status-bar item that opens a self-sizing popover. The popover replaces what used to be a built-in popover (e.g. an AI-usage meter): a small, read-mostly surface anchored to its item.

```json
// package.json
{
  "name": "status-popover",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "devDependencies": { "vite": "^5.0.0" },
  "muxy": {
    "permissions": ["panels:write"],
    "popovers": [
      { "id": "summary", "title": "Summary", "entry": "popovers/summary.html", "width": 280, "height": 200 }
    ],
    "commands": [
      { "id": "open-summary", "title": "Status: Summary", "action": { "kind": "openPopover", "popover": "summary" } }
    ],
    "statusBarItems": [
      { "id": "summary", "icon": { "symbol": "gauge" }, "text": "Status", "side": "right", "command": "open-summary" }
    ]
  }
}
```

```html
<!-- src/popovers/summary.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    /* Popover: transparent body so the native macOS popover material shows through. */
    body { margin: 0; font: 13px -apple-system, system-ui, sans-serif;
           background: transparent; color: var(--muxy-foreground); }
    .box { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .line { color: var(--muxy-foreground-muted); }
    button { font: inherit; padding: 6px 10px; border-radius: 6px;
             background: var(--muxy-surface); color: inherit;
             border: 1px solid var(--muxy-border); cursor: pointer; }
    button:hover { background: var(--muxy-hover); border-color: var(--muxy-accent); }
  </style>
</head>
<body>
  <div class="box">
    <strong>Summary</strong>
    <span class="line" id="line">loading…</span>
    <button onclick="muxy.popover.close()">Close</button>
  </div>
  <script>
    document.getElementById('line').textContent = `running as ${muxy.extensionID}`;
    window.addEventListener('load', () =>
      muxy.popover.resize(
        document.documentElement.scrollWidth,
        document.documentElement.scrollHeight
      )
    );
  </script>
</body>
</html>
```

The popover anchors to the status-bar item, opens/toggles when it is clicked, and dismisses on outside click. No background script is needed.

## Editing & reload workflow

This is an npm + Vite project, so the loop is:

1. **`npm install`** — once after scaffolding or cloning (and whenever dependencies change).
2. **`npm run dev`** — iterate on `src/` with Vite's dev server / fast feedback while building UI.
3. **`npm run build`** — bundle `src/` into `dist/`. Muxy installs and reads `dist/`, so nothing takes effect in the app until you build. The publishing pipeline runs this same `npm run build`.
4. **Reload** — click **Reload** in the Muxy Extensions modal. Muxy terminates the running process, re-reads the `"muxy"` manifest from `package.json`, and re-validates the built files in `dist/`.

After editing the manifest in `package.json`, scripts, tab HTML/CSS/JS, or the background script, **rebuild (`npm run build`) and then Reload** — a Reload alone won't pick up source changes that haven't been built into `dist/`. Tabs are not auto-refreshed — close and reopen them, or use `tabs.open` to get a fresh instance.

## Quick checklist before shipping

- [ ] `package.json` parses; `name`/`version` are top-level and `name` equals the directory name; `scripts.build` is present.
- [ ] `npm run build` succeeds and every path declared in `"muxy"` (entries, `background`, scripts, icons, assets) exists under `dist/`.
- [ ] `muxy.permissions` declares only what is actually used.
- [ ] Every CSS rule for UI chrome uses `var(--muxy-…)`.
- [ ] `muxy.onThemeChange` is wired for any canvas/SVG/JS-rendered color.
- [ ] Hover and active states are visible in both light and dark themes.
- [ ] No hardcoded paths to `~/.config/muxy` from inside the extension — use `muxy.exec({ cwd: … })` or rely on the working directory Muxy sets.
- [ ] Event-driven work happens in the background script, not in tab JS, so closing a tab does not lose state. No background script unless events or background `muxy.exec` are needed.
