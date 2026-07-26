# NewAPI Usage

Multi-site [NewAPI](https://newapi.ai) usage monitor for Muxy. Track balance, total used, and daily usage across multiple NewAPI sites from your status bar.

![Screenshot](./src/assets/screenshot.png)

## Features

- **Status bar** — total balance across all sites at a glance
- **Multi-site management** — add, edit, delete, enable/disable multiple sites
- **Real-time data** — balance, total used, and today's usage per site
- **Auto-refresh** — fetches fresh data on open if the interval has elapsed
- **Balance alert** — set a threshold; balances below it highlight in red
- **Per-site refresh** — refresh individual sites without touching others
- **Concurrent fetching** — all sites fetch simultaneously for fast updates
- **Drag & drop reorder** — rearrange sites by dragging the Name column
- **Number roll animation** — values smoothly animate from old to new
- **Theme-aware** — follows Muxy's light/dark theme automatically

## Installation

1. Clone or download this repository
2. Run `npm install`
3. Run `npm run build`
4. In Muxy, open Extensions → Load Unpacked → select the `dist/` folder
5. Click **Reload** to activate

## Usage

1. Click the status bar icon to open the popover
2. Click **＋** to add a NewAPI site
   - **Name** — a friendly label
   - **API URL** — your NewAPI instance URL (e.g. `https://newapi.example.com`)
   - **Access Token** — your API access token
   - **User ID** — your user ID on that site
3. Each site shows: **Balance**, **Today**, **Used**
4. **✎** — edit or delete a site
5. **↻** on each row — refresh that site only
6. **↻** in header — refresh all sites
7. **Bal** dropdown — set a low-balance warning threshold ($5–$100)
8. **Refresh** dropdown — set auto-refresh interval (1 min to 1 hour)
9. Drag the **Name** column to reorder sites
10. Toggle **Enabled** in the edit form to temporarily disable a site

## Permissions

| Permission | Reason |
| ----------- | -------- |
| `commands:exec` | Runs `curl` and file I/O in the background |
| `panels:write` | Updates the status bar |
| `notifications:write` | Shows toast notifications |
| `storage:read` / `storage:write` | Persists site configs and cached data |

## Development

```bash
npm install
npm run dev    # Vite dev server
npm run build  # Production build
```

Built files go to `dist/`. After rebuilding, click **Reload** in Muxy Extensions.

## Project Structure

```
├── package.json             — Manifest + dependencies + marketplace metadata
├── vite.config.js           — Vite config
├── scripts/
│   ├── build-background.mjs — Copies background.js + assets to dist/
│   └── copy-manifest.mjs    — Copies package.json to dist/
├── popover/
│   └── index.html           — Popover entry
├── src/
│   ├── background.js        — Background polling script
│   ├── popover/
│   │   └── usage.js         — Popover UI logic
│   ├── lib/
│   │   ├── dom.js           — DOM helper utilities
│   │   └── icons.js         — SVG icon helpers
│   ├── assets/
│   │   ├── icon.svg         — Extension icon
│   │   └── screenshot.png   — Marketplace screenshot
│   └── styles/
│       └── global.css       — Theme-aware styles
└── dist/                    — Build output (what Muxy loads)
```

## License

MIT
