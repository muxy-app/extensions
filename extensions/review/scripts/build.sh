#!/usr/bin/env bash
# Local dev build. Bundles the tab's ESM source (tabs/review.js) + its npm
# dependencies (resolved from node_modules via the lib/ adapter modules) into a
# single classic-script IIFE (tabs/review.bundle.js), THEN regenerates dist/ —
# because the locally-installed Muxy serves this extension from dist/ when it
# exists (it resolves the tab entry to dist/tabs/review.html, and a full
# relaunch errors if dist/ is missing). So keeping ONLY the root bundle fresh
# isn't enough; the dev loop must refresh dist/ too. Run `npm install` once to
# populate node_modules, then run this after editing tabs/review.js (or a lib/
# adapter), then Reload in Muxy.
set -euo pipefail
EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$EXT_DIR"
bun build tabs/review.js --target=browser --format=iife --minify \
  --outfile=tabs/review.bundle.js
echo "==> Built tabs/review.bundle.js ($(du -h tabs/review.bundle.js | cut -f1))"
# Refresh the served dist/ (esbuild bundle + copied assets). This is what Muxy
# actually loads — see scripts/build.mjs and the dist/ gotcha in CLAUDE.md.
node "$EXT_DIR/scripts/build.mjs"
