import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";

const dist = resolve("dist");
const out = resolve(dist, "scripts");
mkdirSync(out, { recursive: true });
copyFileSync("package.json", resolve(dist, "package.json"));

for (const name of ["switch-branch"]) {
  buildSync({
    entryPoints: [`scripts/${name}.js`],
    outfile: resolve(out, `${name}.js`),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    alias: { "@": resolve("src") },
  });
}
