// Bundles background.js (plus its src/shared imports) into a single
// self-contained script. The background host is JavaScriptCore, whose module
// support is undocumented, so ship a plain IIFE with no import/export.
import { build } from "esbuild";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

await build({
  entryPoints: [resolve(root, "background.js")],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: resolve(root, "dist/background.js"),
});
