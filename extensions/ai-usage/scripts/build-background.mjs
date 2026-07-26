import { copyFileSync } from "node:fs";
import { buildSync } from "esbuild";

buildSync({
  entryPoints: ["src/background.mjs"],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: "dist/background.js"
});

copyFileSync("package.json", "dist/package.json");
