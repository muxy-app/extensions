#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
  buildOutputDir,
  extensionDir,
  extensionsDir,
  fetchSchema,
  listExtensionNames,
  packageJSONPath,
  readJSON,
  readPackageManifest,
  resolveInside,
} from "./lib/paths.mjs";
import { inspectIcon, inspectScreenshot } from "./lib/images.mjs";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateManifest = ajv.compile(await fetchSchema());

function iconSVG(icon) {
  if (icon && typeof icon === "object" && typeof icon.svg === "string") return icon.svg;
  return null;
}

class Report {
  constructor(name) {
    this.name = name;
    this.errors = [];
    this.warnings = [];
  }
  error(message) {
    this.errors.push(message);
  }
  warn(message) {
    this.warnings.push(message);
  }
  get ok() {
    return this.errors.length === 0;
  }
}

function requireResource(report, dir, relative, label) {
  const { resolved, inside } = resolveInside(dir, relative);
  if (!inside) {
    report.error(`${label} '${relative}' escapes the extension directory`);
    return;
  }
  if (!fs.existsSync(resolved)) {
    report.error(`${label} '${relative}' does not exist`);
    return;
  }
  if (fs.lstatSync(resolved).isSymbolicLink()) {
    report.error(`${label} '${relative}' is a symlink; ship a regular file (symlinks are dropped from the package)`);
  }
}

function checkCrossReferences(report, manifest) {
  const tabTypeIDs = new Set((manifest.tabTypes ?? []).map((t) => t.id));
  const panelIDs = new Set((manifest.panels ?? []).map((p) => p.id));
  const popoverIDs = new Set((manifest.popovers ?? []).map((p) => p.id));
  const commandIDs = new Set((manifest.commands ?? []).map((c) => c.id));

  for (const command of manifest.commands ?? []) {
    const action = command.action ?? { kind: "event" };
    if (action.kind === "openTab" && !tabTypeIDs.has(action.tabType)) {
      report.error(`command '${command.id}' references unknown tabType '${action.tabType}'`);
    }
    if (action.kind === "togglePanel" && !panelIDs.has(action.panel)) {
      report.error(`command '${command.id}' references unknown panel '${action.panel}'`);
    }
    if (action.kind === "openPopover" && !popoverIDs.has(action.popover)) {
      report.error(`command '${command.id}' references unknown popover '${action.popover}'`);
    }
  }

  for (const item of manifest.topbarItems ?? []) {
    if (!commandIDs.has(item.command)) {
      report.error(`topbar item '${item.id}' references unknown command '${item.command}'`);
    }
  }
  for (const item of manifest.statusBarItems ?? []) {
    if (!commandIDs.has(item.command)) {
      report.error(`status bar item '${item.id}' references unknown command '${item.command}'`);
    }
  }
}

function checkDuplicateIDs(report, manifest) {
  const groups = {
    tabType: manifest.tabTypes,
    panel: manifest.panels,
    popover: manifest.popovers,
    command: manifest.commands,
    "topbar item": manifest.topbarItems,
    "status bar item": manifest.statusBarItems,
  };
  for (const [label, items] of Object.entries(groups)) {
    const seen = new Set();
    for (const item of items ?? []) {
      if (seen.has(item.id)) report.error(`duplicate ${label} id '${item.id}'`);
      seen.add(item.id);
    }
  }
  const settingKeys = new Set();
  for (const setting of manifest.settings ?? []) {
    if (settingKeys.has(setting.key)) report.error(`duplicate setting key '${setting.key}'`);
    settingKeys.add(setting.key);
  }
}

function checkResources(report, dir, manifest) {
  if (manifest.background) requireResource(report, dir, manifest.background, "background script");
  for (const tab of manifest.tabTypes ?? []) {
    requireResource(report, dir, tab.entry, `tabType '${tab.id}' entry`);
  }
  for (const panel of manifest.panels ?? []) {
    requireResource(report, dir, panel.entry, `panel '${panel.id}' entry`);
    const svg = iconSVG(panel.icon);
    if (svg) requireResource(report, dir, svg, `panel '${panel.id}' icon`);
  }
  for (const popover of manifest.popovers ?? []) {
    requireResource(report, dir, popover.entry, `popover '${popover.id}' entry`);
  }
  for (const command of manifest.commands ?? []) {
    if (command.action?.kind === "runScript") {
      requireResource(report, dir, command.action.script, `command '${command.id}' script`);
    }
  }
  for (const item of manifest.topbarItems ?? []) {
    const svg = iconSVG(item.icon);
    if (svg) requireResource(report, dir, svg, `topbar item '${item.id}' icon`);
  }
  for (const item of manifest.statusBarItems ?? []) {
    const svg = iconSVG(item.icon);
    if (svg) requireResource(report, dir, svg, `status bar item '${item.id}' icon`);
  }
}

function checkListingAsset(report, dir, relative, label, inspect) {
  const { resolved, inside } = resolveInside(dir, relative);
  if (!inside) {
    report.error(`${label} '${relative}' escapes the extension directory`);
    return;
  }
  if (!fs.existsSync(resolved)) {
    report.error(`${label} '${relative}' does not exist`);
    return;
  }
  if (fs.lstatSync(resolved).isSymbolicLink()) {
    report.error(`${label} '${relative}' is a symlink; ship a regular file`);
    return;
  }
  for (const issue of inspect(resolved).errors) report.error(`${label} '${relative}' ${issue}`);
}

function checkListing(report, dir, manifest) {
  const market = manifest.marketplace;
  if (!market) {
    report.error(
      "missing 'marketplace' block: a listing icon and at least one screenshot are required",
    );
    return;
  }
  if (!market.icon) {
    report.error("marketplace.icon is required (svg or square png ≥256×256)");
  } else {
    checkListingAsset(report, dir, market.icon, "marketplace icon", inspectIcon);
  }

  const screenshots = market.screenshots ?? [];
  if (screenshots.length === 0) {
    report.error("at least one marketplace.screenshot is required (PNG 1600×1000)");
  }
  screenshots.forEach((shot, index) => {
    checkListingAsset(report, dir, shot, `marketplace screenshot #${index + 1}`, inspectScreenshot);
  });
}

const EXEC_PATTERN = /\bmuxy\.exec\b/;
const NETWORK_PATTERN = /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/;
const EVAL_PATTERN = /\b(eval|Function)\s*\(/;
const MIN_MINIFIED_LINE = 2000;

// Scan authored source only. The Vite build output and dependencies are not
// reviewed source — a bundle legitimately has long/minified lines, so linting
// it would be pure noise.
const SKIP_SCAN_DIRS = new Set(["node_modules", buildOutputDir]);

function collectScriptFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIP_SCAN_DIRS.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs|ts|jsx|tsx|vue|svelte|html)$/.test(entry.name)) files.push(full);
    }
  };
  walk(dir);
  return files;
}

function securityLint(report, dir, muxy) {
  const permissions = new Set(muxy.permissions ?? []);
  if (permissions.has("commands:exec")) {
    report.warn("declares commands:exec — reviewer: confirm shell usage is justified and safe");
  }
  const usesRunScript = (muxy.commands ?? []).some((c) => c.action?.kind === "runScript");
  if (usesRunScript && !permissions.has("commands:run-script")) {
    report.warn("has a runScript command but does not declare commands:run-script — it will not run");
  }
  for (const file of collectScriptFiles(dir)) {
    const rel = path.relative(dir, file);
    const content = fs.readFileSync(file, "utf8");
    if (EXEC_PATTERN.test(content) && !permissions.has("commands:exec")) {
      report.warn(`${rel}: calls muxy.exec but commands:exec is not declared`);
    }
    if (NETWORK_PATTERN.test(content)) {
      report.warn(`${rel}: performs network access — reviewer: verify endpoint and data sent`);
    }
    if (EVAL_PATTERN.test(content)) {
      report.warn(`${rel}: uses eval/Function — reviewer: inspect for obfuscation`);
    }
    const longestLine = content.split("\n").reduce((max, line) => Math.max(max, line.length), 0);
    if (longestLine > MIN_MINIFIED_LINE) {
      report.warn(`${rel}: contains a very long line (${longestLine} chars) — possibly minified/obfuscated; ship readable source`);
    }
  }
}

function validateExtension(name) {
  const report = new Report(name);
  const dir = extensionDir(name);
  const manifestPath = packageJSONPath(dir);

  if (!fs.existsSync(manifestPath)) {
    report.error("package.json not found");
    return report;
  }

  let pkg;
  try {
    pkg = readJSON(manifestPath);
  } catch (err) {
    report.error(`package.json is not valid JSON: ${err.message}`);
    return report;
  }

  // The schema (fetched from muxy-app/muxy) describes the whole package.json:
  // top-level name + version + scripts, with the manifest body under `muxy`.
  // Validate the real package as shipped; `manifest`/`muxy` are the flattened
  // views the resource and cross-reference checks below read from. The lockfile
  // requirement is enforced in code (npm-level, not in the schema).
  const { manifest, muxy } = readPackageManifest(dir);

  if (!validateManifest(pkg)) {
    for (const err of validateManifest.errors ?? []) {
      report.error(`manifest${err.instancePath} ${err.message}`);
    }
    return report;
  }

  if (!fs.existsSync(path.join(dir, "package-lock.json"))) {
    report.error("package-lock.json is required (run `npm install` and commit the lockfile)");
  }

  if (pkg.name !== name) {
    report.error(`package name '${pkg.name}' must equal directory name '${name}'`);
  }

  if (!fs.existsSync(path.join(dir, "README.md"))) {
    report.error("README.md is required for every extension");
  }

  // Manifest-referenced resources and listing assets resolve against the build
  // output. They exist only after a build, so this assumes `dist/` is present
  // (CI runs scripts/build.mjs first).
  const distDir = path.join(dir, buildOutputDir);
  if (!fs.existsSync(distDir)) {
    report.error(`'${buildOutputDir}/' not found — run \`node scripts/build.mjs ${name}\` before validating`);
  } else {
    checkResources(report, distDir, manifest);
    checkListing(report, distDir, manifest);
  }
  checkCrossReferences(report, manifest);
  checkDuplicateIDs(report, manifest);
  securityLint(report, dir, muxy);

  return report;
}

function targets(argv) {
  const explicit = argv.filter((arg) => !arg.startsWith("-"));
  if (explicit.length > 0) return explicit;
  return listExtensionNames();
}

function main() {
  if (!fs.existsSync(extensionsDir)) {
    console.log("No extensions/ directory; nothing to validate.");
    return;
  }
  const names = targets(process.argv.slice(2));
  if (names.length === 0) {
    console.log("No extensions to validate.");
    return;
  }

  let failed = 0;
  for (const name of names) {
    const report = validateExtension(name);
    for (const warning of report.warnings) console.log(`::warning::[${name}] ${warning}`);
    if (report.ok) {
      console.log(`✓ ${name}`);
      continue;
    }
    failed += 1;
    for (const error of report.errors) console.log(`::error::[${name}] ${error}`);
    console.log(`✗ ${name} (${report.errors.length} error${report.errors.length === 1 ? "" : "s"})`);
  }

  if (failed > 0) {
    console.error(`\n${failed} extension(s) failed validation.`);
    process.exit(1);
  }
  console.log(`\nAll ${names.length} extension(s) valid.`);
}

main();
