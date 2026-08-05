import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";

const dist = resolve("dist");
const scripts = resolve(dist, "scripts");
mkdirSync(scripts, { recursive: true });
copyFileSync("package.json", resolve(dist, "package.json"));
copyFileSync("scripts/quick-open.js", resolve(scripts, "quick-open.js"));

// find-in-files is split across scripts/find-in-files/, and runScript entries are
// loaded as a single plain script, so this one is bundled rather than copied.
buildSync({
  entryPoints: ["scripts/find-in-files.js"],
  outfile: resolve(scripts, "find-in-files.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
});

const pdfAssets = resolve(dist, "assets", "pdfjs");
for (const directory of ["cmaps", "iccs", "standard_fonts", "wasm"]) {
  cpSync(
    resolve("node_modules", "pdfjs-dist", directory),
    resolve(pdfAssets, directory),
    { recursive: true },
  );
}
