// Copies the extension into dist/, which is what Muxy loads and the store
// publishes. There is nothing to compile: the panel is plain HTML, CSS and JS,
// and the helper is compiled on the user's Mac the first time the panel opens.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const files = ["package.json", "README.md", "icon.svg", "screenshots", "panel", "helper"];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const file of files) {
  const source = join(root, file);
  if (!existsSync(source)) throw new Error(`Missing ${file}`);
  cpSync(source, join(dist, file), { recursive: true });
}
console.log(`Built dist/ with ${files.join(", ")}`);
