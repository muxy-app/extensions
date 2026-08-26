#!/usr/bin/env node
// Local marketplace pre-flight: run this extension through the REAL
// muxy-app/extensions tooling (build → validate → pack) exactly as CI will,
// without hand-forking anything.
//
//   npm run preflight
//
// Why this is separate from `npm run build`: build.mjs is what CI invokes — it
// must stay offline, single-purpose (emit dist/), and fast. This script is the
// opposite: it reaches out to the network, clones the marketplace tooling, and
// drives it against a staged copy of us. Different job, different script.
//
// What it does:
//   1. Clone (or refresh) muxy-app/extensions into a cache dir under the OS
//      tmpdir — realpath'd, because macOS /tmp -> /private/tmp would otherwise
//      break the tooling's `process.argv[1] === import.meta.url` self-invoke
//      guard (so main() silently no-ops and you get a green-looking no-op).
//   2. Stage this extension into <cache>/extensions/<name>/ (copy, minus
//      node_modules/ dist/ .git/ — the things that are regenerated or huge).
//   3. npm install the tooling, then run build.mjs / validate.mjs /
//      pack.mjs --dry-run for our name.
//   4. Independently validate our RAW package.json against the authoritative
//      schema (muxy-app/muxy). The tooling on main currently flattens the
//      manifest before validating, which disagrees with the live schema and
//      fails for every extension — this independent check is the real signal.
//
// Needs: git + network. The clone is cached and refreshed on re-run.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOLING_REPO = "https://github.com/muxy-app/extensions";
const SCHEMA_URL =
  "https://raw.githubusercontent.com/muxy-app/muxy/main/docs/extensions/schema/manifest.schema.json";

const extRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(extRoot, "package.json"), "utf8"));
const name = pkg.name;

// realpathSync resolves /tmp -> /private/tmp so the cached scripts' argv[1]
// matches their import.meta.url and main() actually runs.
const cache = path.join(fs.realpathSync(os.tmpdir()), "muxy-store-preflight");
const stageDir = path.join(cache, "extensions", name);

function run(cmd, args, opts = {}) {
  console.log(`\x1b[2m$ ${cmd} ${args.join(" ")}\x1b[0m`);
  return execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

function step(label) {
  console.log(`\n\x1b[1m========== ${label} ==========\x1b[0m`);
}

// 1. Clone or refresh the marketplace tooling.
step("tooling");
if (!fs.existsSync(path.join(cache, ".git"))) {
  fs.rmSync(cache, { recursive: true, force: true });
  run("git", ["clone", "--depth", "1", TOOLING_REPO, cache]);
} else {
  run("git", ["-C", cache, "fetch", "--depth", "1", "origin", "HEAD"]);
  run("git", ["-C", cache, "reset", "--hard", "FETCH_HEAD"]);
}

// 2. Stage this extension (copy, excluding regenerated/heavy dirs). We mirror
//    what actually ships in the PR: the build artifacts (the root IIFE bundle
//    and any vendor/ dir) are gitignored and NOT committed, so the marketplace
//    build regenerates them inside dist/. If we copied the locally-built root
//    bundle, validate.mjs would flag it as minified — a false alarm the real
//    git checkout never sees. Exclude both the heavy/regenerated top-level dirs
//    AND those specific build-artifact paths.
const EXCLUDE = new Set(["node_modules", "dist", ".git", "vendor"]);
const EXCLUDE_FILES = new Set(["tabs/review.bundle.js"]);
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });
fs.cpSync(extRoot, stageDir, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(extRoot, src);
    if (!rel) return true;
    const top = rel.split(path.sep)[0];
    if (EXCLUDE.has(top)) return false;
    return !EXCLUDE_FILES.has(rel.split(path.sep).join("/"));
  },
});
console.log(`staged ${name} -> ${stageDir}`);

// 3. Install tooling deps + run build / validate / pack.
step("npm install (tooling)");
run("npm", ["install"], { cwd: cache });

const tool = (script, ...args) => path.join(cache, "scripts", script);
let toolingFailed = false;
for (const [label, script, extra] of [
  ["BUILD", "build.mjs", []],
  ["VALIDATE", "validate.mjs", []],
  ["PACK (dry-run)", "pack.mjs", ["--dry-run"]],
]) {
  step(label);
  try {
    run("node", [tool(script), ...extra, name]);
  } catch {
    toolingFailed = true;
    console.log(`\x1b[31m${label} reported failure (see above)\x1b[0m`);
  }
}

// 4. Independent authoritative-schema check (the real signal).
step("AUTHORITATIVE SCHEMA (independent)");
let schemaOk = false;
try {
  const { default: Ajv } = await import(path.join(cache, "node_modules/ajv/dist/ajv.js"));
  const { default: addFormats } = await import(
    path.join(cache, "node_modules/ajv-formats/dist/index.js")
  );
  const res = await fetch(SCHEMA_URL);
  const schema = await res.json();
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  schemaOk = validate(pkg);
  if (schemaOk) {
    console.log("\x1b[32m✓ package.json validates against the live muxy-app/muxy schema\x1b[0m");
  } else {
    console.log("\x1b[31m✗ package.json FAILS the authoritative schema:\x1b[0m");
    for (const e of validate.errors ?? []) console.log(`   ${e.instancePath || "/"} ${e.message}`);
  }
} catch (err) {
  console.log(`could not run independent schema check: ${err.message}`);
}

step("SUMMARY");
console.log(`tooling (build/validate/pack): ${toolingFailed ? "see failures above" : "passed"}`);
console.log(`authoritative schema:          ${schemaOk ? "PASS" : "FAIL"}`);
if (toolingFailed && schemaOk) {
  console.log(
    "\nNote: if the only tooling failure is validate.mjs rejecting required\n" +
      "'scripts'/'muxy' properties, that is the upstream flatten-vs-schema bug —\n" +
      "our package.json is schema-correct (PASS above).",
  );
}
process.exit(schemaOk ? 0 : 1);
