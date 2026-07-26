#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  buildOutputDir,
  extensionDir,
  listExtensionNames,
  packageJSONPath,
  readPackageManifest,
  repoRoot,
} from "./lib/paths.mjs";
import { buildZip } from "./lib/zip.mjs";

const EXCLUDED_FILES = new Set([".DS_Store", "Thumbs.db"]);

function collectFiles(dir, prefix, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      collectFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`, out);
      continue;
    }
    if (EXCLUDED_FILES.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    out.push({ name: `${prefix}${entry.name}`, data: fs.readFileSync(path.join(dir, entry.name)) });
  }
}

export function packExtension(name) {
  const dir = extensionDir(name);
  const { version, muxy } = readPackageManifest(dir);
  // Ship only the Vite build output — the app runs `dist/`, and listing assets
  // (icon, screenshots) are emitted there too. Source, node_modules,
  // package.json, and the lockfile are not shipped.
  const distDir = path.join(dir, buildOutputDir);
  if (!fs.existsSync(distDir)) {
    throw new Error(`${name}: '${buildOutputDir}/' not found — run \`node scripts/build.mjs ${name}\` first`);
  }
  const files = [];
  // Extensions with a background script nest files under `dist/` because Muxy
  // resolves background paths relative to `dist/` at runtime (it creates the
  // directory for logs on first run). Without the nest, reloading the extension
  // fails with "Background script not found at .../dist/background.js".
  // Extensions without background keep the flat structure for backward compat.
  const prefix = muxy.background ? `${name}/dist/` : `${name}/`;
  collectFiles(distDir, prefix, files);
  // ExtensionStore discovers extensions by scanning for package.json at the
  // extension root. When files are nested under dist/, we also put one at root
  // level so the extension is found before `dist/` exists.
  if (muxy.background) {
    files.push({ name: `${name}/package.json`, data: fs.readFileSync(packageJSONPath(dir)) });
  }
  const zip = buildZip(files);
  const sha256 = crypto.createHash("sha256").update(zip).digest("hex");
  return { name, version, zip, sha256, size: zip.length };
}

function outDir() {
  return path.join(repoRoot, "dist");
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const names = argv.filter((arg) => !arg.startsWith("-"));
  const targets = names.length > 0 ? names : listExtensionNames();

  if (targets.length === 0) {
    console.log("No extensions to pack.");
    return;
  }

  for (const name of targets) {
    const { version, zip, sha256, size } = packExtension(name);
    const relative = `${name}/${version}/${name}-${version}.zip`;
    if (dryRun) {
      console.log(`${name}@${version}  ${size} bytes  sha256=${sha256}  (dry-run)`);
      continue;
    }
    const target = path.join(outDir(), relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, zip);
    console.log(`${name}@${version}  ${size} bytes  sha256=${sha256}  -> dist/${relative}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
