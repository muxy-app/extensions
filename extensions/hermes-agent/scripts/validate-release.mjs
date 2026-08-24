import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { validateDist } from "./validate-dist.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const ENTRYPOINTS = ["src/main.js", "src/board-main.js"];
const FORBIDDEN_PRODUCT_NAMES = new Set([
  "capabilities.js",
  "evidence.js",
  "gateway-client.js",
  "probe.js",
  "recovery-evidence.js",
  "recovery-receipt.js",
  "run-client.js",
  "run-controller.js",
  "run-events.js",
  "sse-parser.js",
  "stop-gate.js",
  "verdict.js",
]);
const EXCLUDED_COPY_ROOTS = new Set([".git", ".planning", ".qualification", ".agents", ".gsd", "dist", "node_modules"]);
const EXCLUDED_COPY_FILES = new Set(["skills-lock.json"]);
const SECRET_PATTERNS = [
  { name: "private_key", pattern: /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/ },
  { name: "github_token", pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { name: "openai_key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/ },
  { name: "cloudflare_tunnel_token", pattern: /\beyJhIjoi[A-Za-z0-9._-]{30,}\b/ },
];

async function filesUnder(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const display = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesUnder(path, `${display}/`));
    else if (entry.isFile()) files.push(display);
  }
  return files.sort();
}

function imports(source) {
  return [...source.matchAll(/(?:\bimport\s+(?:[^"']*?\s+from\s+)?|\bexport\s+[^"']*?\s+from\s+)["']([^"']+)["']/g)]
    .map((match) => match[1]);
}

async function resolveModule(from, specifier) {
  const candidate = specifier.startsWith("@/")
    ? resolve(root, "src", specifier.slice(2))
    : resolve(dirname(from), specifier);
  for (const path of [candidate, `${candidate}.js`]) {
    try {
      if ((await stat(path)).isFile()) return path;
    } catch { /* try the next supported source form */ }
  }
  throw new Error(`import_unresolved:${relative(root, from)}:${specifier}`);
}

export async function productionImportGraph() {
  const reachable = new Set();
  const visit = async (path) => {
    const display = relative(root, path);
    if (reachable.has(display)) return;
    reachable.add(display);
    const source = await readFile(path, "utf8");
    for (const specifier of imports(source)) {
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
  const sourceFiles = (await filesUnder(resolve(root, "src"))).filter((file) => file.endsWith(".js")).map((file) => `src/${file}`);
  assert.deepEqual(reachable, sourceFiles, "every product JavaScript module must be reachable from a marketplace entrypoint");
  for (const file of sourceFiles) assert.equal(FORBIDDEN_PRODUCT_NAMES.has(file.split("/").at(-1)), false, `legacy product module remains: ${file}`);
  const relay = await readFile(resolve(root, "src/curl-relay.js"), "utf8");
  assert.doesNotMatch(relay, /bearer|text\/event-stream|streamJournal|journal|Authorization:/i, "legacy transport remains in the current relay");
  return Object.freeze(reachable);
}

function isScannable(file) {
  return /(?:^|\/)(?:README\.md|package(?:-lock)?\.json)$/.test(file)
    || /\.(?:js|mjs|json|md|html|css|svg|yml|yaml|toml)$/.test(file);
}

export async function scanReleaseSecrets(base = root) {
  const files = await filesUnder(base);
  const findings = [];
  const scanned = [];
  for (const file of files) {
    if (!isScannable(file) || file.startsWith(".git/") || file.startsWith("node_modules/") || file.startsWith(".planning/")) continue;
    scanned.push(file);
    const contents = await readFile(resolve(base, file), "utf8");
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(contents)) findings.push(Object.freeze({ file, kind: name }));
    }
  }
  assert.deepEqual(findings, [], `release secret scan failed: ${findings.map(({ file, kind }) => `${file}:${kind}`).join(", ")}`);
  return Object.freeze(scanned);
}

async function npmAudit() {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync(npm, ["audit", "--json"], { cwd: root, maxBuffer: 4 * 1024 * 1024 }));
  } catch (error) {
    stdout = error.stdout ?? "";
  }
  let report;
  try { report = JSON.parse(stdout); } catch { throw new Error("npm_audit_unreadable"); }
  const vulnerabilities = report.metadata?.vulnerabilities ?? {};
  assert.equal(vulnerabilities.high ?? 0, 0, "npm audit contains high vulnerabilities");
  assert.equal(vulnerabilities.critical ?? 0, 0, "npm audit contains critical vulnerabilities");
  return Object.freeze({ high: 0, critical: 0 });
}

export async function validateReleaseGovernance() {
  const [manifestSource, lockSource, changelog, releasing, workflow] = await Promise.all([
    readFile(resolve(root, "package.json"), "utf8"),
    readFile(resolve(root, "package-lock.json"), "utf8"),
    readFile(resolve(root, "CHANGELOG.md"), "utf8"),
    readFile(resolve(root, "RELEASING.md"), "utf8"),
    readFile(resolve(root, ".github/workflows/ci.yml"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const lockfile = JSON.parse(lockSource);
  assert.equal(manifest.private, true, "the marketplace source must remain private to npm");
  assert.equal(lockfile.version, manifest.version, "package-lock version must match package.json");
  assert.equal(lockfile.packages?.[""]?.version, manifest.version, "root lockfile version must match package.json");
  assert.equal(
    Object.keys(manifest.scripts ?? {}).some((name) => /^(?:prepublish|prepublishOnly|publish|postpublish)$/.test(name)),
    false,
    "package scripts must not publish to npm",
  );

  assert.match(changelog, /^## \[?Unreleased\]?/m, "changelog must contain Unreleased notes");
  assert.match(changelog, new RegExp(`^## \\[${manifest.version}\\]`, "m"), "changelog must cover the current package version");
  for (const heading of ["Versioning", "Prepare a release", "Merge the source release first", "Submit a draft marketplace pull request", "After upstream merge", "Rollback"]) {
    assert.match(releasing, new RegExp(`^## ${heading}`, "m"), `release guide must include ${heading}`);
  }
  for (const contract of [
    /package\.json.*version source/i,
    /package-lock\.json.*match/i,
    /patch.*fixes.*security.*documentation.*listing/i,
    /minor.*features.*permission.*deployment/i,
    /hermes-agent@version.*immutable/i,
    /hermes-agent-vX\.Y\.Z/,
    /source repository is the release source of truth/i,
    /exact merged source commit/i,
    /pushed to `gabeosx\/extensions`/i,
    /Do not commit or push directly to `muxy-app\/extensions`/i,
    /No npm publish step/i,
    /stops at a draft pull request/i,
    /npm test/,
    /npm run validate/,
    /npm run qualify/,
    /node scripts\/validate\.mjs hermes-agent/,
    /node scripts\/pack\.mjs --dry-run hermes-agent/,
  ]) assert.match(releasing, contract, "release guide lacks a required contract");

  const workflowDirectory = resolve(root, ".github/workflows");
  const workflowFiles = (await readdir(workflowDirectory)).filter((file) => /\.ya?ml$/.test(file)).sort();
  assert.deepEqual(workflowFiles, ["ci.yml"], "the source repository must have one bounded CI workflow");
  assert.match(workflow, /^on:\n  push:\n  pull_request:\n  workflow_dispatch:/m, "CI must run for pushes, pull requests, and manual dispatch");
  assert.match(workflow, /^permissions:\n  contents: read$/m, "CI must use top-level read-only contents permission");
  assert.equal([...workflow.matchAll(/^\s*permissions:/gm)].length, 1, "CI must not grant job-level permissions");
  assert.match(workflow, /node-version:\s*20/, "CI must use Node 20");
  assert.match(workflow, /uses:\s*actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\s+# v4/, "checkout must use the reviewed immutable v4 pin");
  assert.match(workflow, /uses:\s*actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\s+# v4/, "setup-node must use the reviewed immutable v4 pin");
  for (const command of ["npm ci", "npm test", "npm run validate"]) assert.ok(workflow.includes(command), `CI must run ${command}`);
  assert.match(workflow, /if:\s*github\.event_name == 'workflow_dispatch'/, "qualification must be manual only");
  assert.match(workflow, /npm run qualify/, "manual qualification must be available");
  assert.doesNotMatch(workflow, /secrets\.|permissions:\s*write|npm publish|\bdeploy\b/i, "CI must not receive secrets or publish authority");
  return Object.freeze({ version: manifest.version, workflow: Object.freeze({ node: 20 }) });
}

async function runChecked(command, args, { cwd, label, timeout = 180_000 } = {}) {
  try {
    return await execFileAsync(command, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    const exitCode = Number.isInteger(error.code) ? error.code : "unknown";
    const signal = typeof error.signal === "string" ? `:${error.signal}` : "";
    throw new Error(`${label}_failed:${exitCode}${signal}`);
  }
}

function copyFilter(source) {
  const display = relative(root, source);
  if (!display) return true;
  const [top] = display.split(/[\\/]/);
  return !EXCLUDED_COPY_ROOTS.has(top) && !EXCLUDED_COPY_FILES.has(display) && !display.endsWith(".log");
}

async function distDigests(copyRoot) {
  const dist = resolve(copyRoot, "dist");
  const files = await filesUnder(dist);
  const digests = {};
  for (const file of files) digests[file] = createHash("sha256").update(await readFile(resolve(dist, file))).digest("hex");
  return Object.freeze({ files: Object.freeze(files), digests: Object.freeze(digests) });
}

async function qualifyCleanCopy(parent, index) {
  const copyRoot = resolve(parent, `copy-${index}`);
  await cp(root, copyRoot, { recursive: true, filter: copyFilter });
  await runChecked(npm, ["ci", "--no-audit", "--no-fund"], { cwd: copyRoot, label: `copy_${index}_npm_ci`, timeout: 300_000 });
  for (let pass = 1; pass <= 2; pass += 1) {
    await runChecked(npm, ["test"], { cwd: copyRoot, label: `copy_${index}_test_${pass}`, timeout: 180_000 });
  }
  await runChecked(process.execPath, ["scripts/validate-dist.mjs"], { cwd: copyRoot, label: `copy_${index}_dist`, timeout: 180_000 });
  return distDigests(copyRoot);
}

export async function validateCleanCopies() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hermes-agent-release-"));
  let result;
  try {
    const first = await qualifyCleanCopy(temporaryRoot, 1);
    const second = await qualifyCleanCopy(temporaryRoot, 2);
    assert.deepEqual(second.files, first.files, "clean copies produced different dist inventories");
    assert.deepEqual(second.digests, first.digests, "clean copies produced non-identical distributions");
    result = Object.freeze({ files: first.files, digest: createHash("sha256").update(JSON.stringify(first.digests)).digest("hex") });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    try { await stat(temporaryRoot); assert.fail("release temporary root survived cleanup"); } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return result;
}

export async function validateRelease({ structuralOnly = false } = {}) {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  assert.ok(major >= 20, `Node 20 or newer is required; found ${process.version}`);
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.equal(packageJson.engines?.node, ">=20");
  assert.equal(Object.keys(packageJson.dependencies ?? {}).length, 0);

  const governance = await validateReleaseGovernance();
  const graph = await validateImportReachability();
  await scanReleaseSecrets(root);
  const audit = await npmAudit();
  if (structuralOnly) return Object.freeze({ node: process.version, governance, graph, audit, cleanCopies: null });

  await runChecked(npm, ["test"], { cwd: root, label: "canonical_test_1" });
  await runChecked(npm, ["test"], { cwd: root, label: "canonical_test_2" });
  const distribution = await validateDist();
  await scanReleaseSecrets(resolve(root, "dist"));
  const cleanCopies = await validateCleanCopies();
  assert.equal(cleanCopies.files.length, distribution.files.length, "canonical and clean-copy distributions differ in size");
  return Object.freeze({ node: process.version, governance, graph, audit, distribution, cleanCopies });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const structuralOnly = process.argv.includes("--structural");
  const result = await validateRelease({ structuralOnly });
  console.log(JSON.stringify({
    ok: true,
    node: result.node,
    productModules: result.graph.length,
    audit: result.audit,
    cleanCopyDigest: result.cleanCopies?.digest ?? null,
  }, null, 2));
}
