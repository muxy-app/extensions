#!/usr/bin/env bash
# Bundles the tab's ESM source (tabs/review.js) + vendored libraries into a
# single classic-script IIFE (tabs/review.bundle.js). Loading a classic script
# avoids any ES-module / file:// scheme concerns in the Muxy webview.
#
# Run after editing tabs/review.js (or any vendor bundle), then Reload in Muxy.
set -euo pipefail
EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$EXT_DIR"
bun build tabs/review.js --target=browser --format=iife --minify \
  --outfile=tabs/review.bundle.js
echo "==> Built tabs/review.bundle.js ($(du -h tabs/review.bundle.js | cut -f1))"
