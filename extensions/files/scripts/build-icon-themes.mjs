// Compiles the bundled Material Icon Theme (the npm package has the same layout
// as its .vsix) with the same compiler used for imported themes, so the
// built-in theme gets every file, folder, and light-mode mapping.
// Run with: npm run gen-icons.

import { readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile_package } from "../src/shared/icon-themes/compile.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..", "node_modules", "material-icon-theme");
const at = (path) => resolve(pkgRoot, path);

const source = {
  has: (path) => existsSync(at(path)) && statSync(at(path)).isFile(),
  size: (path) => statSync(at(path)).size,
  text: async (path) => readFileSync(at(path), "utf8"),
  bytes: async (path) => new Uint8Array(readFileSync(at(path))),
};

const { pack, themes, errors } = await compile_package(source, { packageJsonPath: "package.json" });
if (errors.length) throw new Error(`Material Icon Theme failed to compile: ${JSON.stringify(errors)}`);
const theme = { ...themes[0], id: "material", builtin: true };
const target = resolve(here, "..", "src", "shared", "icon-themes", "material.generated.json");
writeFileSync(target, JSON.stringify(theme));
console.log(`Wrote ${target}: ${pack.displayName} ${pack.version}, ${theme.stats.icons} icons, ` +
  `${theme.stats.fileExtensions} extensions, ${theme.stats.fileNames} file names, ${theme.stats.folderNames} folder names`);
