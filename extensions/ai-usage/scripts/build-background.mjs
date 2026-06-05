import { execFileSync } from "node:child_process";

execFileSync("node", [
  "node_modules/esbuild/bin/esbuild",
  "src/background.mjs",
  "--bundle",
  "--format=iife",
  "--target=es2020",
  "--outfile=dist/background.js"
], { stdio: "inherit" });
