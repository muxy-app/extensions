import { buildSync } from "esbuild";

// The background host runs a plain script (no module loader), so bundle
// src/background.mjs and its imports into a single IIFE file.
buildSync({
  entryPoints: ["src/background.mjs"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: false,
  outfile: "dist/background.js",
});
