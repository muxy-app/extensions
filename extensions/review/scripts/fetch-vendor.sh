#!/usr/bin/env bash
# Rebuilds everything under vendor/ from scratch. Safe to re-run.
#
#   vendor/codemirror/codemirror.js  — one self-contained CodeMirror 6 bundle
#                                       (single @codemirror/state instance)
#   vendor/trees/trees.js            — @pierre/trees bundle (preact inlined)
#
# Both are self-contained ESM, so the tab needs no import map. Re-run after
# bumping a pinned version below.
#
# Requires: bun + npx (esbuild) on PATH. Network access.
set -euo pipefail

EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$EXT_DIR/vendor"
TREES_VERSION="1.0.0-beta.4"

build_bundle() {
  # build_bundle <entry-src> <out-file> <pkg...>
  local entry="$1"; local out="$2"; shift 2
  local dir; dir="$(mktemp -d)"
  cp "$EXT_DIR/vendor-src/$entry" "$dir/entry.js"
  ( cd "$dir"
    printf '{ "name": "b", "private": true, "type": "module" }\n' > package.json
    bun add "$@" >/dev/null 2>&1
    mkdir -p "$(dirname "$out")"
    npx --yes esbuild entry.js --bundle --format=esm --minify --outfile="$out" )
  rm -rf "$dir"
}

echo "==> Building CodeMirror bundle"
build_bundle cm-entry.js "$VENDOR/codemirror/codemirror.js" \
  codemirror@^6 @codemirror/state @codemirror/view @codemirror/language \
  @codemirror/commands @codemirror/search @codemirror/legacy-modes @lezer/highlight \
  @codemirror/lang-javascript @codemirror/lang-json @codemirror/lang-html \
  @codemirror/lang-css @codemirror/lang-python @codemirror/lang-markdown \
  @codemirror/lang-php @codemirror/lang-rust @codemirror/lang-cpp \
  @codemirror/lang-java @codemirror/lang-xml @codemirror/lang-sql \
  @codemirror/lang-yaml @codemirror/lang-go

echo "==> Building @pierre/trees bundle"
rm -rf "$VENDOR/trees" "$VENDOR/preact"
build_bundle trees-entry.js "$VENDOR/trees/trees.js" "@pierre/trees@$TREES_VERSION"

echo "==> Building marked bundle"
rm -rf "$VENDOR/marked"
build_bundle marked-entry.js "$VENDOR/marked/marked.js" marked@^15

echo "==> Done."
ls -la "$VENDOR/codemirror/codemirror.js" "$VENDOR/trees/trees.js"
