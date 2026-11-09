// Copies the extension's runtime files into dist/. There is nothing to compile.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const files = ["package.json", "background.js", "dock", "assets", "README.md"];

rmSync(dist, { recursive: true, force: true });
for (const f of files) {
  const src = join(root, f);
  if (existsSync(src)) cpSync(src, join(dist, f), { recursive: true });
}
console.log(`Built ${files.length} entries into dist/`);
