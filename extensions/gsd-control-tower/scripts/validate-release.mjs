import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { filesUnder, validateBuilt, validateDist } from "./validate-dist.mjs";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const ENTRYPOINTS = ["src/main.js"];
const EXCLUDED_COPY_ROOTS = new Set([
  ".git", ".research", ".agents", ".planning", ".qualification", ".gsd", "dist", "node_modules", ".npm-cache",
]);
const EXCLUDED_COPY_FILES = new Set(["skills-lock.json", ".DS_Store"]);
const SECRET_PATTERNS = [
  { kind: "private_key", pattern: /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/ },
  { kind: "github_token", pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { kind: "openai_key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/ },
  { kind: "credential_url", pattern: /\b(?:https?|postgres(?:ql)?):\/\/[^\s/@:]+:[^\s/@]+@/i },
  { kind: "personal_home", pattern: /(?:\/Users\/(?!Shared\/)[^/\s"'<>]+|\/home\/[^/\s"'<>]+|[A-Za-z]:\\Users\\[^\\\s"'<>]+)/ },
];

function imports(source) {
  return [...source.matchAll(/(?:\bimport\s+(?:[^"']*?\s+from\s+)?|\bexport\s+[^"']*?\s+from\s+)["']([^"']+)["']/g)]
    .map((match) => match[1]);
}

async function resolveModule(from, specifier) {
  const candidate = specifier.startsWith("@/")
    ? resolve(root, "src", specifier.slice(2))
    : resolve(dirname(from), specifier);
  for (const path of [candidate, `${candidate}.js`]) {
    try { if ((await stat(path)).isFile()) return path; } catch { /* try supported suffix */ }
  }
  throw new Error(`import_unresolved:${relative(root, from)}:${specifier}`);
}

export async function productionImportGraph() {
  const reachable = new Set();
  const visit = async (path) => {
    const display = relative(root, path);
    if (reachable.has(display)) return;
    reachable.add(display);
    for (const specifier of imports(await readFile(path, "utf8"))) {
      if (!(specifier.startsWith(".") || specifier.startsWith("@/"))) continue;
      const target = await resolveModule(path, specifier);
      if (target.endsWith(".js")) await visit(target);
    }
  };
  for (const entry of ENTRYPOINTS) await visit(resolve(root, entry));
  return [...reachable].sort();
}

export async function validateImportReachability() {
  const reachable = await productionImportGraph();
  const product = (await filesUnder(resolve(root, "src")))
    .filter((file) => file.endsWith(".js"))
    .map((file) => `src/${file}`);
  assert.deepEqual(reachable, product, "every production JavaScript module must be reachable from a shipped entrypoint");
  return Object.freeze(reachable);
}

function scannable(file) {
  return /(?:^|\/)(?:README|CHANGELOG|RELEASING|OPEN_ISSUES)\.md$/.test(file)
    || /(?:^|\/)package(?:-lock)?\.json$/.test(file)
    || /\.(?:js|mjs|json|md|html|css|svg|yml|yaml|toml)$/.test(file);
}

export async function scanReleaseSecrets(base = root) {
  const findings = [];
  const scanned = [];
  const excluded = new Set([".git", ".research", ".agents", ".planning", "node_modules", "dist"]);
  const scanFiles = async (directory, prefix = "") => {
    const out = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const display = `${prefix}${entry.name}`;
      const top = display.split("/")[0];
      if (excluded.has(top)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) out.push(...await scanFiles(path, `${display}/`));
      else if (entry.isFile()) out.push(display);
    }
    return out;
  };
  for (const file of await scanFiles(base)) {
    if (!scannable(file)) continue;
    scanned.push(file);
    const source = await readFile(resolve(base, file), "utf8");
    for (const { kind, pattern } of SECRET_PATTERNS) {
      if (pattern.test(source)) findings.push({ file, kind });
    }
  }
  assert.deepEqual(findings, [], `release secret/private-path scan failed: ${findings.map(({ file, kind }) => `${file}:${kind}`).join(", ")}`);
  return Object.freeze(scanned);
}

async function npmAudit() {
  let output = "";
  try {
    ({ stdout: output } = await run(npm, ["audit", "--json"], { cwd: root, maxBuffer: 4 * 1024 * 1024 }));
  } catch (error) {
    output = error.stdout ?? "";
  }
  let report;
  try { report = JSON.parse(output); } catch { throw new Error("npm_audit_unreadable"); }
  assert.equal(report.metadata?.vulnerabilities?.high ?? 0, 0, "npm audit contains high vulnerabilities");
  assert.equal(report.metadata?.vulnerabilities?.critical ?? 0, 0, "npm audit contains critical vulnerabilities");
  return Object.freeze({ high: 0, critical: 0 });
}

export async function validateReleaseGovernance() {
  const [manifestText, lockText, changelog, releasing, readme, workflow] = await Promise.all([
    readFile(resolve(root, "package.json"), "utf8"),
    readFile(resolve(root, "package-lock.json"), "utf8"),
    readFile(resolve(root, "CHANGELOG.md"), "utf8"),
    readFile(resolve(root, "RELEASING.md"), "utf8"),
    readFile(resolve(root, "README.md"), "utf8"),
    readFile(resolve(root, ".github/workflows/ci.yml"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const lock = JSON.parse(lockText);
  assert.equal(manifest.private, true, "package must remain npm-private");
  assert.equal(lock.version, manifest.version, "package-lock version must match package.json");
  assert.equal(lock.packages?.[""]?.version, manifest.version, "root lockfile version must match package.json");
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, "runtime dependencies are forbidden");
  assert.equal(Object.keys(manifest.scripts ?? {}).some((name) => /^(?:prepublish|prepublishOnly|publish|postpublish)$/.test(name)), false, "npm publication lifecycle scripts are forbidden");
  assert.equal(manifest.muxy?.marketplace?.repository, "https://github.com/gabeosx/muxy-gsd-control-tower", "marketplace source repository changed");
  assert.equal(manifest.muxy?.marketplace?.homepage, "https://github.com/gabeosx/muxy-gsd-control-tower", "marketplace homepage changed");
  assert.match(changelog, /^## \[?Unreleased\]?/m);
  assert.match(changelog, new RegExp(`^## \\[${manifest.version}\\]`, "m"));
  for (const heading of ["Versioning", "Prepare a release", "Prepare the marketplace source", "After upstream merge", "Rollback"]) {
    assert.match(releasing, new RegExp(`^## ${heading}`, "m"), `release guide lacks ${heading}`);
  }
  for (const contract of [
    /package\.json.*version source/i, /package-lock\.json.*match/i,
    /patch releases for fixes, security, documentation, and listing/i,
    /minor releases for features, permission changes/i,
    /gsd-control-tower@version.*immutable/i, /gsd-control-tower-vX\.Y\.Z/,
    /No npm publish step/i, /local, unpushed commit/i,
    /node scripts\/build\.mjs gsd-control-tower/,
    /node scripts\/validate\.mjs gsd-control-tower/,
    /node scripts\/pack\.mjs --dry-run gsd-control-tower/,
  ]) assert.match(releasing, contract, "release guide lacks a required immutable-release contract");
  assert.match(readme, /Muxy 1\.5\.0 \(945\)/);
  assert.match(readme, /gsd_state_version: 1\.0/);
  assert.match(readme, /Remote workspaces are not supported/);

  const workflows = (await readdir(resolve(root, ".github/workflows"))).filter((file) => /\.ya?ml$/.test(file));
  assert.deepEqual(workflows, ["ci.yml"], "one bounded CI workflow is allowed");
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.equal([...workflow.matchAll(/^\s*permissions:/gm)].length, 1, "job-level permissions are forbidden");
  assert.match(workflow, /actions\/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09\s+# v5/);
  assert.match(workflow, /actions\/setup-node@a0853c24544627f65ddf259abe73b1d18a591444\s+# v5/);
  for (const command of ["npm ci", "npm test", "npm run validate"]) assert.ok(workflow.includes(command), `CI must run ${command}`);
  assert.doesNotMatch(workflow, /secrets\.|permissions:\s*write|npm publish|\bdeploy\b/i, "CI must not receive secrets or publication authority");
  return Object.freeze({ version: manifest.version });
}

async function runChecked(command, args, { cwd, label, timeout = 300_000 }) {
  try {
    await run(command, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    const code = Number.isInteger(error.code) ? error.code : "unknown";
    const signal = typeof error.signal === "string" ? `:${error.signal}` : "";
    throw new Error(`${label}_failed:${code}${signal}`);
  }
}

function copyFilter(source) {
  const display = relative(root, source);
  if (!display) return true;
  const top = display.split(/[\\/]/)[0];
  return !EXCLUDED_COPY_ROOTS.has(top) && !EXCLUDED_COPY_FILES.has(display) && !display.endsWith(".log");
}

async function distFingerprint(copyRoot) {
  const files = await filesUnder(resolve(copyRoot, "dist"));
  const digests = {};
  for (const file of files) digests[file] = createHash("sha256").update(await readFile(resolve(copyRoot, "dist", file))).digest("hex");
  return Object.freeze({ files: Object.freeze(files), digests: Object.freeze(digests) });
}

async function qualifyCleanCopy(parent, index) {
  const copyRoot = resolve(parent, `copy-${index}`);
  await cp(root, copyRoot, { recursive: true, filter: copyFilter });
  await runChecked(npm, ["ci", "--no-audit", "--no-fund"], { cwd: copyRoot, label: `copy_${index}_npm_ci` });
  await runChecked(npm, ["test"], { cwd: copyRoot, label: `copy_${index}_test` });
  await runChecked(npm, ["run", "build"], { cwd: copyRoot, label: `copy_${index}_build` });
  await runChecked(process.execPath, ["scripts/validate-dist.mjs", "--built-only"], { cwd: copyRoot, label: `copy_${index}_dist` });
  return distFingerprint(copyRoot);
}

export async function validateCleanCopies() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "gsd-control-tower-release-"));
  try {
    const first = await qualifyCleanCopy(temporaryRoot, 1);
    const second = await qualifyCleanCopy(temporaryRoot, 2);
    assert.deepEqual(second.files, first.files, "clean copies produced different inventories");
    assert.deepEqual(second.digests, first.digests, "clean copies produced non-identical distributions");
    return Object.freeze({ files: first.files, digest: createHash("sha256").update(JSON.stringify(first.digests)).digest("hex") });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    try { await stat(temporaryRoot); assert.fail("temporary release directory survived cleanup"); } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

export async function validateRelease({ structuralOnly = false } = {}) {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  assert.ok(major >= 20, `Node 20 or newer required; found ${process.version}`);
  const governance = await validateReleaseGovernance();
  const graph = await validateImportReachability();
  await scanReleaseSecrets(root);
  const audit = await npmAudit();
  if (structuralOnly) return Object.freeze({ governance, graph, audit, distribution: null, cleanCopies: null });
  await runChecked(npm, ["test"], { cwd: root, label: "canonical_test" });
  const distribution = await validateDist();
  await scanReleaseSecrets(dist);
  const cleanCopies = await validateCleanCopies();
  assert.deepEqual(cleanCopies.files, distribution.files, "canonical and clean-copy inventories differ");
  return Object.freeze({ governance, graph, audit, distribution, cleanCopies });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await validateRelease({ structuralOnly: process.argv.includes("--structural") });
  console.log(JSON.stringify({
    ok: true,
    version: result.governance.version,
    productModules: result.graph.length,
    audit: result.audit,
    cleanCopyDigest: result.cleanCopies?.digest ?? null,
  }, null, 2));
}
