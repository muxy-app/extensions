#!/usr/bin/env node
// Analyses one or more extensions and prints a short Markdown security report
// to stdout, intended to be posted as a PR comment. It lists each extension's
// declared permissions (with a plain-English explanation and risk level) and a
// few automated security signals derived from the authored source.
//
// Usage: node scripts/security-comment.mjs [name ...]
// With no names, every extension is analysed. The comment is wrapped in a
// stable marker so the workflow can update one sticky comment in place.
import fs from "node:fs";
import path from "node:path";
import {
  buildOutputDir,
  extensionDir,
  extensionsDir,
  listExtensionNames,
  packageJSONPath,
  readPackageManifest,
} from "./lib/paths.mjs";

// Stable marker so the posting step can find and update its own comment.
export const COMMENT_MARKER = "<!-- muxy-extension-security-report -->";

// Plain-English meaning and a coarse risk level for each permission. `high`
// permissions can read or change things outside the extension's own surface
// (the filesystem, the repo, the shell); `medium` can write to the workspace
// UI or send data out; `low` is read-only/local.
const PERMISSIONS = {
  "files:read": { risk: "high", what: "Read files anywhere in the project" },
  "files:write": { risk: "high", what: "Create, modify, or delete files in the project" },
  "git:read": { risk: "medium", what: "Read git state (status, history, diffs)" },
  "git:write": { risk: "high", what: "Run git operations that change the repo (commit, checkout, etc.)" },
  "worktrees:read": { risk: "low", what: "Read the list of worktrees" },
  "worktrees:write": { risk: "medium", what: "Create, switch, or remove worktrees" },
  "projects:read": { risk: "low", what: "Read open projects" },
  "projects:write": { risk: "medium", what: "Open, close, or switch projects" },
  "panes:read": { risk: "low", what: "Read terminal/editor pane state" },
  "panes:write": { risk: "medium", what: "Create or manipulate panes" },
  "tabs:read": { risk: "low", what: "Read open tabs" },
  "tabs:write": { risk: "low", what: "Open or close tabs" },
  "panels:write": { risk: "low", what: "Show or hide the extension's own panels" },
  "notifications:write": { risk: "low", what: "Post desktop/in-app notifications" },
  "commands:run-script": { risk: "medium", what: "Run a bundled script shipped with the extension" },
  "commands:exec": { risk: "high", what: "Execute arbitrary shell commands on the host" },
  "remote:serve": { risk: "high", what: "Open a network-facing server the host can reach" },
};

const RISK_BADGE = { high: "🔴 High", medium: "🟠 Medium", low: "🟢 Low" };
const RISK_ORDER = { high: 0, medium: 1, low: 2 };

// Source-scan signals — same heuristics validate.mjs uses, surfaced here as
// reviewer-facing notes rather than CI annotations.
const EXEC_PATTERN = /\bmuxy\.exec\b/;
const NETWORK_PATTERN = /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/;
const EVAL_PATTERN = /\b(eval|Function)\s*\(/;
const MIN_MINIFIED_LINE = 2000;
const SKIP_SCAN_DIRS = new Set(["node_modules", buildOutputDir]);

function collectScriptFiles(dir) {
  const files = [];
  const walk = (current) => {
    if (!fs.existsSync(current)) return;
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

// Returns reviewer-facing signal strings for one extension's source tree.
function scanSource(dir, permissions) {
  const signals = [];
  let networkFiles = 0;
  let evalFiles = 0;
  let minifiedFiles = 0;

  for (const file of collectScriptFiles(dir)) {
    const content = fs.readFileSync(file, "utf8");
    if (NETWORK_PATTERN.test(content)) networkFiles += 1;
    if (EVAL_PATTERN.test(content)) evalFiles += 1;
    const longest = content.split("\n").reduce((max, line) => Math.max(max, line.length), 0);
    if (longest > MIN_MINIFIED_LINE) minifiedFiles += 1;
  }

  if (networkFiles > 0) {
    signals.push(`🌐 Makes network requests in ${networkFiles} file(s) — verify the endpoints and what data is sent.`);
  }
  if (evalFiles > 0) {
    signals.push(`⚠️ Uses \`eval\`/\`Function\` in ${evalFiles} file(s) — inspect for obfuscation.`);
  }
  if (minifiedFiles > 0) {
    signals.push(`📦 ${minifiedFiles} file(s) look minified/obfuscated — extensions should ship readable source.`);
  }
  if (permissions.has("commands:exec")) {
    signals.push("🖥️ Can run shell commands (`commands:exec`) — confirm the usage is justified.");
  }
  return signals;
}

function analyseExtension(name) {
  const dir = extensionDir(name);
  if (!fs.existsSync(packageJSONPath(dir))) return null;

  const { version, muxy } = readPackageManifest(dir);
  const declared = muxy.permissions ?? [];
  const permissionSet = new Set(declared);

  const permissions = declared
    .map((id) => ({ id, ...(PERMISSIONS[id] ?? { risk: "low", what: "Unknown permission" }) }))
    .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.id.localeCompare(b.id));

  const highest = permissions.reduce(
    (acc, p) => (RISK_ORDER[p.risk] < RISK_ORDER[acc] ? p.risk : acc),
    "low",
  );

  return {
    name,
    version,
    description: muxy.description ?? "",
    permissions,
    highestRisk: permissions.length ? highest : "low",
    signals: scanSource(dir, permissionSet),
  };
}

function renderExtension(ext) {
  const lines = [];
  const title = ext.version ? `${ext.name} v${ext.version}` : ext.name;
  lines.push(`### \`${title}\` — overall ${RISK_BADGE[ext.highestRisk]}`);
  if (ext.description) lines.push(`_${ext.description}_`);
  lines.push("");

  if (ext.permissions.length === 0) {
    lines.push("**Permissions:** none declared.");
  } else {
    lines.push("**Permissions**");
    lines.push("");
    lines.push("| Permission | Risk | What it allows |");
    lines.push("| --- | --- | --- |");
    for (const p of ext.permissions) {
      lines.push(`| \`${p.id}\` | ${RISK_BADGE[p.risk]} | ${p.what} |`);
    }
  }
  lines.push("");

  lines.push("**Security signals**");
  lines.push("");
  if (ext.signals.length === 0) {
    lines.push("- ✅ No automated flags. Permissions still warrant a manual review.");
  } else {
    for (const signal of ext.signals) lines.push(`- ${signal}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderComment(extensions) {
  const lines = [COMMENT_MARKER];
  lines.push("## 🔐 Extension security review");
  lines.push("");

  if (extensions.length === 0) {
    lines.push("No extensions changed in this PR.");
    return lines.join("\n");
  }

  lines.push(
    `Analysed ${extensions.length} extension(s). Risk is heuristic — a maintainer must still review the code and permissions before merge.`,
  );
  lines.push("");
  for (const ext of extensions) lines.push(renderExtension(ext));
  lines.push("---");
  lines.push(
    "<sub>Generated by `scripts/security-comment.mjs`. Permission risk levels are advisory.</sub>",
  );
  return lines.join("\n");
}

function targets(argv) {
  const explicit = argv.filter((arg) => !arg.startsWith("-"));
  if (explicit.length > 0) return explicit;
  return listExtensionNames();
}

function main() {
  if (!fs.existsSync(extensionsDir)) {
    process.stdout.write(`${COMMENT_MARKER}\n## 🔐 Extension security review\n\nNo extensions/ directory found.\n`);
    return;
  }
  const names = targets(process.argv.slice(2));
  const extensions = names.map(analyseExtension).filter(Boolean);
  process.stdout.write(renderComment(extensions) + "\n");
}

main();
