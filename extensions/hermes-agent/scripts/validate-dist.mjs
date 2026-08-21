import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const allowedManifestKeys = new Set(["$schema", "description", "commands", "marketplace", "panels", "permissions", "tabTypes"]);
const allowedPanelKeys = new Set(["entry", "icon", "id", "mode", "position", "title"]);
const allowedTabTypeKeys = new Set(["entry", "id", "title"]);
const allowedCommandKeys = new Set(["id", "title", "action"]);
const allowedCommandActionKeys = new Set(["kind", "panel", "tabType"]);
const REQUIRED_PERMISSIONS = ["commands:exec", "panels:write", "storage:read", "storage:write", "tabs:write"];
const REQUIRED_SCREENSHOTS = [
  "assets/screenshots/screenshot-1.png",
  "assets/screenshots/screenshot-2.png",
  "assets/screenshots/screenshot-3.png",
  "assets/screenshots/screenshot-4.png",
];
const README_SCREENSHOTS = Object.freeze([
  "assets/readme/operations.png",
  "assets/readme/agent-approval.png",
  "assets/readme/project-board.png",
]);

function inside(base, path) {
  const child = relative(base, path);
  return child !== "" && !child.startsWith("..") && !isAbsolute(child);
}

async function filesUnder(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const display = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesUnder(path, `${display}/`));
    else if (entry.isFile()) files.push(display);
    else assert.fail(`distribution contains a non-file entry: ${display}`);
  }
  return files.sort();
}

async function parseJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assertManifest(manifest, label) {
  assert.equal(manifest.name, "hermes-agent", `${label} must use the marketplace extension ID`);
  assert.equal(manifest.version, "0.1.0", `${label} must use the immutable beta version`);
  assert.equal(manifest.engines?.node, ">=20", `${label} must declare Node 20 compatibility`);
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, `${label} must not add runtime dependencies`);
  assert.ok(manifest.muxy && typeof manifest.muxy === "object", `${label} must contain a muxy manifest`);
  for (const key of Object.keys(manifest.muxy)) {
    assert.ok(allowedManifestKeys.has(key), `${label} contains unauthorized Muxy surface: ${key}`);
  }
  assert.deepEqual(manifest.muxy.permissions, REQUIRED_PERMISSIONS, `${label} must request only current product permissions`);
  assert.equal(Object.hasOwn(manifest.muxy, "events"), false, `${label} must not subscribe to workspace events`);
  assert.equal(Object.hasOwn(manifest.muxy, "background"), false, `${label} must not own background activity`);

  assert.ok(Array.isArray(manifest.muxy.panels) && manifest.muxy.panels.length === 1, `${label} must declare one panel`);
  const [panel] = manifest.muxy.panels;
  for (const key of Object.keys(panel)) assert.ok(allowedPanelKeys.has(key), `${label} panel contains unauthorized surface: ${key}`);
  assert.equal(panel.entry, "panel/index.html");

  assert.deepEqual(manifest.muxy.tabTypes, [{ id: "hermes-project-board", title: "Hermes Project Board", entry: "board/index.html" }]);
  for (const tab of manifest.muxy.tabTypes) {
    for (const key of Object.keys(tab)) assert.ok(allowedTabTypeKeys.has(key), `${label} tab contains unauthorized surface: ${key}`);
  }
  assert.deepEqual(manifest.muxy.commands, [
    { id: "toggle-hermes-gateway", title: "Hermes: Toggle Agent Panel", action: { kind: "togglePanel", panel: panel.id } },
    { id: "open-hermes-project-board", title: "Hermes: Open Project Board", action: { kind: "openTab", tabType: "hermes-project-board" } },
  ]);
  for (const command of manifest.muxy.commands) {
    for (const key of Object.keys(command)) assert.ok(allowedCommandKeys.has(key), `${label} command contains unauthorized surface: ${key}`);
    for (const key of Object.keys(command.action)) assert.ok(allowedCommandActionKeys.has(key), `${label} action contains unauthorized surface: ${key}`);
  }

  assert.deepEqual(manifest.muxy.marketplace, {
    author: "Gabe",
    categories: ["developer-tools", "productivity"],
    github: "gabeosx",
    icon: "assets/icon.svg",
    screenshots: REQUIRED_SCREENSHOTS,
  }, `${label} must contain the frozen listing metadata`);
  return [panel.entry, manifest.muxy.tabTypes[0].entry];
}

function htmlAssets(html) {
  return [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);
}

async function collectModule(modulePath, declared, visited) {
  const display = relative(dist, modulePath);
  if (visited.has(display)) return;
  visited.add(display);
  declared.add(display);
  const source = await readFile(modulePath, "utf8");
  const references = [...source.matchAll(/\bimport(?:[\s\S]*?\bfrom\s*)?["']([^"']+)["']/g)].map((match) => match[1]);
  for (const asset of references) {
    if (!asset.startsWith(".")) continue;
    const path = resolve(modulePath, "..", asset);
    assert.ok(inside(dist, path), `module asset escapes dist: ${asset}`);
    assert.ok((await stat(path)).isFile(), `module asset is missing: ${asset}`);
    await collectModule(path, declared, visited);
  }
}

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG", "screenshot must be a PNG");
  assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR", "screenshot must contain a PNG IHDR");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function validateReadmeScreenshots(base, declared = null) {
  for (const screenshot of README_SCREENSHOTS) {
    const path = resolve(base, screenshot);
    assert.ok(inside(base, path), `README screenshot escapes package: ${screenshot}`);
    assert.deepEqual(
      pngDimensions(await readFile(path)),
      { width: 760, height: 475 },
      `${screenshot} must be exactly 760×475`,
    );
    declared?.add(screenshot);
  }
}

async function validateListingAssets(base, declared = null) {
  const iconPath = resolve(base, "assets/icon.svg");
  assert.ok(inside(base, iconPath));
  const icon = await readFile(iconPath, "utf8");
  assert.ok(Buffer.byteLength(icon) <= 512 * 1024, "marketplace icon exceeds 512KB");
  assert.match(icon, /^<svg[\s>]/);
  assert.doesNotMatch(icon, /<script|<foreignObject|\b(?:href|src)=["'](?:https?:|data:)/i, "marketplace icon must be self-contained static SVG");
  declared?.add("assets/icon.svg");
  for (const screenshot of REQUIRED_SCREENSHOTS) {
    const path = resolve(base, screenshot);
    assert.ok(inside(base, path), `screenshot escapes package: ${screenshot}`);
    const dimensions = pngDimensions(await readFile(path));
    assert.deepEqual(dimensions, { width: 1600, height: 1000 }, `${screenshot} must be exactly 1600×1000`);
    declared?.add(screenshot);
  }
}

async function validateBuild() {
  const source = await parseJson(resolve(root, "package.json"));
  const published = await parseJson(resolve(dist, "package.json"));
  const sourceEntries = assertManifest(source, "source package.json");
  const distEntries = assertManifest(published, "dist/package.json");
  assert.deepEqual(published, source, "source and dist package.json must match exactly");
  assert.deepEqual(distEntries, sourceEntries);

  const declared = new Set(["package.json", "README.md", "OPEN_ISSUES.md"]);
  assert.equal(await readFile(resolve(dist, "README.md"), "utf8"), await readFile(resolve(root, "README.md"), "utf8"), "dist README differs from source");
  assert.equal(await readFile(resolve(dist, "OPEN_ISSUES.md"), "utf8"), await readFile(resolve(root, "OPEN_ISSUES.md"), "utf8"), "dist OPEN_ISSUES differs from source");
  await validateListingAssets(root);
  await validateListingAssets(dist, declared);
  await validateReadmeScreenshots(root);
  await validateReadmeScreenshots(dist, declared);

  const visited = new Set();
  for (const entry of distEntries) {
    const path = resolve(dist, entry);
    assert.ok(inside(dist, path) && (await stat(path)).isFile(), `surface entry missing: ${entry}`);
    declared.add(entry);
    const html = await readFile(path, "utf8");
    for (const asset of htmlAssets(html)) {
      assert.ok(!asset.startsWith("/") && !asset.includes("://"), `surface has external or absolute asset: ${asset}`);
      const assetPath = resolve(path, "..", asset);
      assert.ok(inside(dist, assetPath) && (await stat(assetPath)).isFile(), `surface asset missing: ${asset}`);
      if (assetPath.endsWith(".js")) await collectModule(assetPath, declared, visited);
      else declared.add(relative(dist, assetPath));
    }
  }
  const emitted = await filesUnder(dist);
  assert.deepEqual(emitted, [...declared].sort(), "dist contains undeclared or missing files");
  return emitted;
}

async function digests(files) {
  const result = {};
  for (const file of files) result[file] = createHash("sha256").update(await readFile(resolve(dist, file))).digest("hex");
  return result;
}

export async function validateDist({ buildTwice = true } = {}) {
  await run(npm, ["run", "build"], { cwd: root });
  const firstFiles = await validateBuild();
  const firstDigests = await digests(firstFiles);
  if (buildTwice) {
    await run(npm, ["run", "build"], { cwd: root });
    const secondFiles = await validateBuild();
    assert.deepEqual(secondFiles, firstFiles, "two builds emitted different file inventories");
    assert.deepEqual(await digests(secondFiles), firstDigests, "two builds were not byte-identical");
  }
  return Object.freeze({ files: Object.freeze(firstFiles), digests: Object.freeze(firstDigests) });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await validateDist();
  console.log(`Validated deterministic ${result.files.length}-file marketplace distribution.`);
}
