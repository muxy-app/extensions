import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";

execFileSync("node", [
  "node_modules/esbuild/bin/esbuild",
  "src/background.mjs",
  "--bundle",
  "--format=iife",
  "--target=es2020",
  "--outfile=dist/background.js"
], { stdio: "inherit" });

copyFileSync("package.json", "dist/package.json");
