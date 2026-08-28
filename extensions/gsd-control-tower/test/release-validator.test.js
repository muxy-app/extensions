import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  productionImportGraph,
  scanReleaseSecrets,
  validateImportReachability,
  validateReleaseGovernance,
} from "../scripts/validate-release.mjs";

test("every product JavaScript module is reachable from a shipped entrypoint", async () => {
  const graph = await productionImportGraph();
  assert.ok(graph.includes("src/main.js"));
  assert.deepEqual(await validateImportReachability(), graph);
});

test("release secret scan excludes private planning inputs and finds no credentials", async () => {
  const scanned = await scanReleaseSecrets();
  assert.ok(scanned.includes("README.md"));
  assert.ok(scanned.includes("package.json"));
  assert.equal(scanned.some((file) => file.startsWith(".research/") || file.startsWith(".agents/")), false);
});

test("release governance freezes versions, CI authority, and handoff docs", async () => {
  const governance = await validateReleaseGovernance();
  assert.equal(governance.version, "0.2.0");
});

test("release validator owns isolated-copy cleanup and deterministic comparison", async () => {
  const source = await readFile(new URL("../scripts/validate-release.mjs", import.meta.url), "utf8");
  assert.match(source, /mkdtemp\(join\(tmpdir\(\), "gsd-control-tower-release-"\)\)/);
  assert.match(source, /rm\(temporaryRoot, \{ recursive: true, force: true \}\)/);
  assert.match(source, /assert\.deepEqual\(second\.digests, first\.digests/);
  assert.match(source, /EXCLUDED_COPY_ROOTS/);
});
