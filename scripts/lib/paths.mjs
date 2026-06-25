import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

export const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const extensionsDir = path.join(repoRoot, "extensions");

// The manifest schema is owned by the Muxy app repo (muxy-app/muxy). During
// local cross-repo development, prefer a sibling checkout or MUXY_MANIFEST_SCHEMA;
// otherwise fetch the published schema from muxy-app/muxy.
export const schemaURL =
  "https://raw.githubusercontent.com/muxy-app/muxy/main/docs/extensions/schema/manifest.schema.json";
export const localSchemaPath =
  process.env.MUXY_MANIFEST_SCHEMA ??
  path.resolve(repoRoot, "../muxy/docs/extensions/schema/manifest.schema.json");

// Permissions the live app and docs ship that the published schema enum may not
// yet list. Merged into the fetched schema so a lagging schema doesn't reject a
// valid manifest. Drop entries here once they land in muxy-app/muxy's schema.
export const EXTRA_PERMISSIONS = ["files:read", "files:write"];

export async function fetchSchema() {
  let schema;
  if (fs.existsSync(localSchemaPath)) {
    schema = readJSON(localSchemaPath);
  } else {
    const res = await fetch(schemaURL);
    if (!res.ok) {
      throw new Error(`failed to fetch manifest schema from ${schemaURL} (HTTP ${res.status})`);
    }
    schema = await res.json();
  }
  const permEnum = schema?.$defs?.permission?.enum;
  if (Array.isArray(permEnum)) {
    for (const perm of EXTRA_PERMISSIONS) {
      if (!permEnum.includes(perm)) permEnum.push(perm);
    }
  }
  return schema;
}

export function listExtensionNames() {
  if (!fs.existsSync(extensionsDir)) return [];
  return fs
    .readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

export function extensionDir(name) {
  return path.join(extensionsDir, name);
}

export function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// The manifest file an extension ships. The Muxy manifest lives under the
// `muxy` key of the npm `package.json`; identity (`name`, `version`) and the
// required `build` script live at the top level where npm expects them.
export const manifestFileName = "package.json";

// Directory (relative to an extension) that the Vite build emits and that gets
// packed and signed.
export const buildOutputDir = "dist";

export function packageJSONPath(dir) {
  return path.join(dir, manifestFileName);
}

// Reads an extension's package.json and returns its parts. `muxy` is the
// manifest body (everything that used to live in manifest.json). `manifest` is
// a flattened view (top-level name/version merged into the muxy fields) so the
// existing validate/pack/publish logic can keep reading `manifest.popovers`,
// `manifest.permissions`, etc.
export function readPackageManifest(dir) {
  const pkg = readJSON(packageJSONPath(dir));
  const muxy = pkg.muxy ?? {};
  return {
    name: pkg.name,
    version: pkg.version,
    scripts: pkg.scripts ?? {},
    muxy,
    manifest: { ...muxy, name: pkg.name, version: pkg.version },
  };
}

function iconSVGPath(icon) {
  if (icon && typeof icon === "object" && typeof icon.svg === "string") return icon.svg;
  return null;
}

// The set of files (paths relative to the build output) that the muxy block
// references and that therefore must exist in `dist/` after a build: entries,
// background script, icons, and marketplace listing assets.
export function referencedBuildFiles(muxy) {
  const files = new Set();
  if (muxy.background) files.add(muxy.background);
  for (const tab of muxy.tabTypes ?? []) if (tab.entry) files.add(tab.entry);
  for (const panel of muxy.panels ?? []) {
    if (panel.entry) files.add(panel.entry);
    const svg = iconSVGPath(panel.icon);
    if (svg) files.add(svg);
  }
  for (const popover of muxy.popovers ?? []) if (popover.entry) files.add(popover.entry);
  for (const command of muxy.commands ?? []) {
    if (command.action?.kind === "runScript" && command.action.script) {
      files.add(command.action.script);
    }
  }
  for (const item of muxy.topbarItems ?? []) {
    const svg = iconSVGPath(item.icon);
    if (svg) files.add(svg);
  }
  for (const item of muxy.statusBarItems ?? []) {
    const svg = iconSVGPath(item.icon);
    if (svg) files.add(svg);
  }
  const market = muxy.marketplace ?? {};
  if (market.icon) files.add(market.icon);
  for (const shot of market.screenshots ?? []) files.add(shot);
  return [...files];
}

export function resolveInside(baseDir, relative) {
  const resolved = path.resolve(baseDir, relative);
  const normalizedBase = path.resolve(baseDir) + path.sep;
  const inside = resolved === path.resolve(baseDir) || resolved.startsWith(normalizedBase);
  return { resolved, inside };
}
