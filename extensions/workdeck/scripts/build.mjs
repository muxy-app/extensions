/* Publishing build: copies what the extension needs at runtime into dist/ (or $OUT) and leaves package.json there.
 * Nothing is bundled or minified, so the source stays readable. demo/, logs/ and scripts/ are not shipped. */
import { cpSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.env.OUT || join(root, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const item of ["package.json", "package-lock.json", "README.md", "LICENSE", "i18n.js", "sidebar", "tab", "notes", "modal", "switcher", "assets"]) {
  if (existsSync(join(root, item))) cpSync(join(root, item), join(out, item), { recursive: true });
}
const pkg = JSON.parse(readFileSync(join(out, "package.json"), "utf8"));
console.log(`built ${pkg.name}@${pkg.version} -> ${out}`);
