import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const PERMISSIONS = [
  "projects:read", "worktrees:read", "agents:read", "files:read", "git:read",
  "panels:write", "storage:read", "storage:write",
];
const EVENTS = [
  "agent.status", "file.changed", "projects.changed", "project.switched",
  "worktree.switched", "worktree.headChanged",
];
const SCREENSHOTS = [
  "assets/screenshots/screenshot-1.png",
  "assets/screenshots/screenshot-2.png",
];
const README_IMAGES = [
  "assets/readme/active-project.png",
  "assets/readme/phase-details.png",
];

function expectedMuxy() {
  return {
    $schema: "https://raw.githubusercontent.com/muxy-app/muxy/main/docs/extensions/schema/manifest.schema.json",
    description: "Read GSD next steps, roadmap progress, and live agent activity across Muxy projects.",
    permissions: PERMISSIONS,
    events: EVENTS,
    marketplace: {
      author: "Gabe",
      categories: ["developer-tools", "productivity"],
      github: "gabeosx",
      homepage: "https://github.com/gabeosx/muxy-gsd-control-tower",
      repository: "https://github.com/gabeosx/muxy-gsd-control-tower",
      icon: "assets/icon.svg",
      screenshots: SCREENSHOTS,
    },
    panels: [{
      id: "control-tower", title: "GSD Control Tower", icon: { symbol: "tower.broadcast" },
      entry: "panel/index.html", position: "right", mode: "pinned",
      headerButtons: [
        { id: "refresh", icon: { symbol: "arrow.clockwise" }, tooltip: "Refresh all workstreams", command: "refresh-tower" },
        { id: "diagnostics", icon: { symbol: "info.circle" }, tooltip: "Toggle diagnostics", command: "toggle-diagnostics" },
      ],
    }],
    statusBarItems: [{
      id: "tower", icon: { symbol: "circle.dashed" }, text: "",
      tooltip: "GSD Control Tower", side: "right", command: "toggle-tower",
    }],
    commands: [
      { id: "toggle-tower", title: "Control Tower: Toggle Panel", defaultShortcut: "cmd+shift+g", action: { kind: "togglePanel", panel: "control-tower" } },
      { id: "refresh-tower", title: "Control Tower: Refresh All Workstreams" },
      { id: "toggle-diagnostics", title: "Control Tower: Toggle Diagnostics View" },
    ],
  };
}

function inside(base, path) {
  const child = relative(base, path);
  return child !== "" && !child.startsWith("..") && !isAbsolute(child);
}

async function filesUnder(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const display = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesUnder(path, `${display}/`));
    else if (entry.isFile()) files.push(display);
    else assert.fail(`distribution contains non-file entry: ${display}`);
  }
  return files.sort();
}

function htmlAssets(html) {
  return [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);
}

function pngInfo(buffer) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "screenshot must be PNG");
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    assert.ok(offset + 12 + length <= buffer.length, `PNG chunk ${type} is truncated`);
    chunks.push(type);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  assert.equal(chunks[0], "IHDR");
  assert.ok(chunks.includes("IDAT") && chunks.at(-1) === "IEND", "PNG must contain IDAT and terminal IEND");
  for (const forbidden of ["tEXt", "zTXt", "iTXt", "eXIf"]) {
    assert.equal(chunks.includes(forbidden), false, `PNG metadata chunk ${forbidden} is forbidden`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), chunks };
}

async function validateListingAssets(base, declared = null) {
  const iconPath = resolve(base, "assets/icon.svg");
  assert.ok(inside(base, iconPath));
  const icon = await readFile(iconPath, "utf8");
  assert.ok(Buffer.byteLength(icon) <= 512 * 1024, "marketplace icon exceeds 512KB");
  assert.match(icon, /^<svg[\s>]/);
  assert.doesNotMatch(icon, /<script|<foreignObject|\b(?:href|src)=["'](?:https?:|data:)/i, "icon must be static and self-contained");
  declared?.add("assets/icon.svg");
  for (const screenshot of SCREENSHOTS) {
    const path = resolve(base, screenshot);
    assert.ok(inside(base, path), `${screenshot} escapes package`);
    assert.deepEqual(
      { width: pngInfo(await readFile(path)).width, height: pngInfo(await readFile(path)).height },
      { width: 1600, height: 1000 },
      `${screenshot} must be exactly 1600×1000`,
    );
    declared?.add(screenshot);
  }
  for (const image of README_IMAGES) {
    const path = resolve(base, image);
    assert.ok(inside(base, path), `${image} escapes package`);
    assert.deepEqual(
      { width: pngInfo(await readFile(path)).width, height: pngInfo(await readFile(path)).height },
      { width: 760, height: 475 },
      `${image} must be exactly 760×475`,
    );
    declared?.add(image);
  }
}

async function validateSchema(manifest) {
  const { default: Ajv } = await import("ajv");
  const schema = JSON.parse(await readFile(resolve(root, "scripts/manifest.schema.json"), "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const format of ["uri", "uri-reference", "date-time"]) ajv.addFormat(format, true);
  const valid = ajv.validate(schema, manifest);
  assert.equal(valid, true, `manifest schema failed: ${(ajv.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ")}`);
}

function assertManifest(manifest, label) {
  assert.equal(manifest.name, "gsd-control-tower", `${label}: frozen marketplace ID changed`);
  assert.equal(manifest.version, "0.1.0", `${label}: immutable release version changed`);
  assert.equal(manifest.private, true, `${label}: npm package must remain private`);
  assert.equal(manifest.engines?.node, ">=20", `${label}: Node contract changed`);
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, `${label}: runtime dependencies are forbidden`);
  assert.deepEqual(manifest.muxy, expectedMuxy(), `${label}: frozen Muxy surface changed`);
}

async function validateBuilt() {
  const sourceText = await readFile(resolve(root, "package.json"), "utf8");
  const distText = await readFile(resolve(dist, "package.json"), "utf8");
  const source = JSON.parse(sourceText);
  const published = JSON.parse(distText);
  assertManifest(source, "source package.json");
  assertManifest(published, "dist/package.json");
  assert.equal(distText, sourceText, "source and dist package.json must match byte-for-byte");
  await validateSchema(source);
  await validateListingAssets(root);

  const declared = new Set(["package.json"]);
  await validateListingAssets(dist, declared);
  const panelEntry = resolve(dist, source.muxy.panels[0].entry);
  assert.ok(inside(dist, panelEntry) && (await stat(panelEntry)).isFile(), "panel entry missing");
  declared.add(source.muxy.panels[0].entry);
  for (const asset of htmlAssets(await readFile(panelEntry, "utf8"))) {
    assert.ok(!asset.startsWith("/") && !asset.includes("://"), `panel asset is external or absolute: ${asset}`);
    const assetPath = resolve(dirname(panelEntry), asset);
    assert.ok(inside(dist, assetPath) && (await stat(assetPath)).isFile(), `panel asset missing: ${asset}`);
    declared.add(relative(dist, assetPath));
  }
  const files = await filesUnder(dist);
  assert.deepEqual(files, [...declared].sort(), "dist contains undeclared, missing, or exploratory files");

  const js = await Promise.all(files.filter((file) => file.endsWith(".js")).map((file) => readFile(resolve(dist, file), "utf8")));
  assert.ok(js.some((text) => text.includes(source.version)), "built JavaScript lacks package version marker");
  assert.equal(js.some((text) => text.includes("0.0.0-dev")), false, "dev fallback leaked into production JavaScript");
  const digests = {};
  for (const file of files) digests[file] = createHash("sha256").update(await readFile(resolve(dist, file))).digest("hex");
  return Object.freeze({ files: Object.freeze(files), digests: Object.freeze(digests) });
}

export async function validateDist({ buildTwice = true } = {}) {
  await run(npm, ["run", "build"], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  const first = await validateBuilt();
  if (buildTwice) {
    await run(npm, ["run", "build"], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    const second = await validateBuilt();
    assert.deepEqual(second.files, first.files, "canonical builds produced different inventories");
    assert.deepEqual(second.digests, first.digests, "canonical builds were not byte-identical");
  }
  return first;
}

export { filesUnder, pngInfo, validateBuilt, validateListingAssets };

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const builtOnly = process.argv.includes("--built-only");
  const result = builtOnly ? await validateBuilt() : await validateDist();
  console.log(`Validated deterministic ${result.files.length}-file marketplace distribution.`);
}
