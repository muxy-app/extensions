import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve("dist");
const scripts = resolve(dist, "scripts");
mkdirSync(scripts, { recursive: true });
copyFileSync("package.json", resolve(dist, "package.json"));
copyFileSync("scripts/quick-open.js", resolve(scripts, "quick-open.js"));
copyFileSync("scripts/find-in-files.js", resolve(scripts, "find-in-files.js"));

const pdfAssets = resolve(dist, "assets", "pdfjs");
for (const directory of ["cmaps", "iccs", "standard_fonts", "wasm"]) {
  cpSync(
    resolve("node_modules", "pdfjs-dist", directory),
    resolve(pdfAssets, directory),
    { recursive: true },
  );
}
