import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";

const dist = resolve("dist");
const scripts = resolve(dist, "scripts");
mkdirSync(scripts, { recursive: true });
copyFileSync("package.json", resolve(dist, "package.json"));

// runScript entries are loaded as a single plain script, so each palette
// script is bundled with the modules it imports.
for (const name of ["quick-open", "find-in-files"]) {
  buildSync({
    entryPoints: [`scripts/${name}.js`],
    outfile: resolve(scripts, `${name}.js`),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
  });
}

const pdfAssets = resolve(dist, "assets", "pdfjs");
for (const directory of ["cmaps", "iccs", "standard_fonts", "wasm"]) {
  cpSync(
    resolve("node_modules", "pdfjs-dist", directory),
    resolve(pdfAssets, directory),
    { recursive: true },
  );
}
