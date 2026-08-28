#!/usr/bin/env node
// Marketplace build: assemble the shipped `dist/` tree.
//
// The muxy-app/extensions pipeline ships ONLY `dist/` (pack.mjs zips it and
// nothing else), so dist holds exactly the runtime payload + the manifest —
// no raw source, no vendor/, no CLAUDE.md/.claude/.agents/scripts/diff.html.
// The pipeline DOES require package.json (the manifest) inside dist/, so we
// copy it through; everything else is regenerated runtime.
// We mirror the extension's on-disk layout into dist so every relative path in
// the manifest (and every relative URL in review.html) resolves unchanged.
//
//   dist/
//     package.json            <- the manifest (name/version + `muxy` block)
//     tabs/review.html
//     tabs/review.css
//     tabs/review.bundle.js   <- esbuild output (vendor libs inlined)
//     assets/*                <- topbar icon + marketplace icon/screenshots
//
// review.js imports the libraries through the thin adapter modules in lib/
// (which import from the `@codemirror/*`, `@pierre/trees`, and `marked` npm
// packages declared in package.json `dependencies`). The marketplace pipeline
// runs `npm ci --ignore-scripts` (registry access) to install that locked tree,
// then `npm run build` with npm_config_offline=true — so esbuild bundles
// everything from node_modules with NO network at build time. No vendored
// bundles are committed: shipping minified source trips the store's
// readable-source check, and the libs are now first-class dependencies.
//
// Local dev is a separate track: scripts/build.sh writes the root
// tabs/review.bundle.js that the locally-installed Muxy loads via manifest.json.
// This script never touches the repo root; it only writes dist/.

import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = path.join(root, "dist");

function copy(rel) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) return false;
  const dest = path.join(dist, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

// 1. Clean dist.
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "tabs"), { recursive: true });

// 2. Bundle the tab (vendor libs inlined) -> dist/tabs/review.bundle.js.
//    Matches the local build.sh: classic IIFE so the webview loads it as a
//    plain <script> with no ES-module / custom-scheme concerns.
await build({
  entryPoints: [path.join(root, "tabs/review.js")],
  bundle: true,
  format: "iife",
  minify: true,
  target: ["chrome120"],
  outfile: path.join(dist, "tabs/review.bundle.js"),
  logLevel: "info",
});

// 3. Copy the static runtime files (paths the manifest / html reference).
copy("tabs/review.html");
copy("tabs/review.css");

// 3a. Emit the manifest. The muxy-app/extensions pipeline now requires the
//     extension's package.json (the marketplace manifest — name/version + the
//     `muxy` block) to be present IN dist/, so the packed zip is self-describing.
//     Build fails without it: "build did not emit 'package.json' into 'dist/'".
copy("package.json");

// 4. Copy every listing/runtime asset (icon, topbar glyph, screenshots).
const assetsDir = path.join(root, "assets");
const missing = [];
for (const rel of ["assets/review.svg", "assets/icon.svg", "assets/screenshot-1.png"]) {
  if (!copy(rel)) missing.push(rel);
}
// Copy any other assets too, so adding a screenshot needs no edit here.
if (fs.existsSync(assetsDir)) {
  for (const name of fs.readdirSync(assetsDir)) copy(path.join("assets", name));
}

console.log(`==> Built dist/ from ${path.relative(process.cwd(), root) || "."}`);
if (missing.length) {
  console.log(
    `==> WARNING: referenced asset(s) missing (validation will fail until added): ${missing.join(", ")}`,
  );
}
