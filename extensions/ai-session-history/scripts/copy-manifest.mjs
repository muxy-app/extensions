import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = resolve(import.meta.dirname ?? dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const distScripts = resolve(dist, "scripts");
const srcRoot = resolve(root, "src");

await mkdir(dist, { recursive: true });
await mkdir(distScripts, { recursive: true });
await copyFile(resolve(root, "package.json"), resolve(dist, "package.json"));

// Bundle resume-picker as a single IIFE from shared JS modules (no Python).
const pickerOut = resolve(root, "scripts/resume-picker.built.js");
const pickerDist = resolve(distScripts, "resume-picker.built.js");
const pickerDistAlt = resolve(distScripts, "resume-picker.js");

await esbuild.build({
  entryPoints: [resolve(root, "scripts/resume-picker-entry.js")],
  bundle: true,
  format: "iife",
  platform: "neutral",
  target: ["es2020"],
  outfile: pickerOut,
  logLevel: "warning",
  // Resolve @/… the same way Vite does for the panel.
  plugins: [
    {
      name: "alias-at",
      setup(build) {
        build.onResolve({ filter: /^@\// }, (args) => ({
          path: resolve(srcRoot, args.path.slice(2)),
        }));
      },
    },
  ],
});

const built = await readFile(pickerOut, "utf8");
// Guard rails: no bare ESM import/export statements, no python3 runtime.
// Match real statements at line start (ignore comments / string noise).
// Do NOT short-circuit on `/*` — IIFE output always contains block comments.
if (/^\s*import\s+/m.test(built)) {
  throw new Error("resume-picker.built.js still contains ESM import statements");
}
if (/^\s*export\s+/m.test(built)) {
  throw new Error("resume-picker.built.js still contains ESM export statements");
}
if (/\bpython3\b/.test(built)) {
  throw new Error("resume-picker.built.js must not reference python3");
}

await writeFile(pickerDist, built, "utf8");
await writeFile(pickerDistAlt, built, "utf8");
console.log("Built scripts/resume-picker.built.js (IIFE, no Python)");
