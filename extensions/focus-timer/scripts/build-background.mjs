import { buildSync } from "esbuild";

// The background host runs a plain script (no module loader), so bundle
// src/background.js and its imports into a single IIFE file.
buildSync({
  entryPoints: ["src/background.js"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: false,
  outfile: "dist/background.js",
});
