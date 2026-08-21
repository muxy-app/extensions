import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { productionImportGraph, scanReleaseSecrets, validateImportReachability, validateReleaseGovernance } from "../scripts/validate-release.mjs";

test("production import graph contains only current Dashboard and Muxy modules", async () => {
  const graph = await productionImportGraph();
  assert.deepEqual(graph, [
    "src/board-main.js",
    "src/board/app.js",
    "src/curl-relay.js",
    "src/dashboard-agent.js",
    "src/dashboard-auth.js",
    "src/dashboard-gateway.js",
    "src/dashboard-operations.js",
    "src/kanban-client.js",
    "src/lib/dom.js",
    "src/lib/icons.js",
    "src/main.js",
    "src/muxy-tabs.js",
    "src/panel/app.js",
    "src/session-broker.js",
    "src/stop-confirmation.js",
  ]);
  assert.deepEqual(await validateImportReachability(), graph);
});

test("release secret scanner returns file names only and finds no credential material", async () => {
  const scanned = await scanReleaseSecrets();
  assert.ok(scanned.includes("README.md"));
  assert.ok(scanned.includes("OPEN_ISSUES.md"));
  assert.ok(scanned.includes("package.json"));
  assert.equal(scanned.some((file) => file.startsWith(".planning/")), false);
});

test("release validator owns clean-copy cleanup and never exposes command output", async () => {
  const source = await readFile(new URL("../scripts/validate-release.mjs", import.meta.url), "utf8");
  assert.match(source, /mkdtemp\(join\(tmpdir\(\), "hermes-agent-release-"\)\)/);
  assert.match(source, /rm\(temporaryRoot, \{ recursive: true, force: true \}\)/);
  assert.match(source, /copy_\$\{index\}_test_\$\{pass\}/);
  assert.match(source, /assert\.deepEqual\(second\.digests, first\.digests/);
  assert.match(source, /throw new Error\(`\$\{label\}_failed:\$\{exitCode\}\$\{signal\}`\)/);
});

test("release documents define the immutable draft-only marketplace handoff", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const [changelog, releasing, readme] = await Promise.all([
    readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
    readFile(new URL("../RELEASING.md", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(changelog, /^# Changelog/m);
  assert.match(changelog, /^## \[?Unreleased\]?/m);
  assert.match(changelog, new RegExp(`^## \\[${manifest.version}\\]`, "m"));
  for (const heading of ["Versioning", "Prepare a release", "Submit a draft marketplace pull request", "After upstream merge", "Rollback"]) {
    assert.match(releasing, new RegExp(`^## ${heading}`, "m"));
  }
  assert.match(releasing, /package\.json.*version source/i);
  assert.match(releasing, /package-lock\.json.*match/i);
  assert.match(releasing, /patch.*fixes.*security.*documentation.*listing/i);
  assert.match(releasing, /minor.*features.*permission.*deployment/i);
  assert.match(releasing, /hermes-agent@version.*immutable/i);
  assert.match(releasing, /hermes-agent-vX\.Y\.Z/);
  assert.match(releasing, /No npm publish step/i);
  assert.match(releasing, /stops at a draft pull request/i);
  for (const command of ["npm test", "npm run validate", "npm run qualify", "npm ci", "node scripts/validate.mjs hermes-agent", "node scripts/pack.mjs --dry-run hermes-agent"]) {
    assert.ok(releasing.includes(command), `release guide must include ${command}`);
  }
  for (const excluded of ["dist/", ".planning/", ".qualification/", ".agents/", ".gsd/", "node_modules/", "receipts", "credentials", "generated qualification data", "local caches/logs", "skills-lock.json"]) {
    assert.ok(releasing.includes(excluded), `release guide must exclude ${excluded}`);
  }
  for (const retained of ["fixtures/", "qualification/", ".github/workflows/ci.yml"]) {
    assert.ok(releasing.includes(retained), `release guide must retain ${retained}`);
  }
  assert.match(readme, /\[CHANGELOG\.md\]\(CHANGELOG\.md\)/);
  assert.match(readme, /\[RELEASING\.md\]\(RELEASING\.md\)/);
});

test("release governance bounds CI, versions, copy exclusions, and publication authority", async () => {
  const [manifestSource, lockSource, workflow, validator] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../scripts/validate-release.mjs", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const lockfile = JSON.parse(lockSource);
  assert.equal(manifest.private, true);
  assert.equal(lockfile.version, manifest.version);
  assert.equal(lockfile.packages[""].version, manifest.version);
  assert.equal(Object.keys(manifest.scripts).some((name) => /^(?:prepublish|prepublishOnly|publish|postpublish)$/.test(name)), false);
  assert.match(validator, /EXCLUDED_COPY_ROOTS.*\.qualification/s);
  assert.match(validator, /validateReleaseGovernance/);

  assert.match(workflow, /^on:\n  push:\n  pull_request:\n  workflow_dispatch:/m);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.equal([...workflow.matchAll(/^\s*permissions:/gm)].length, 1);
  assert.match(workflow, /node-version:\s*20/);
  assert.match(workflow, /uses:\s*actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\s+# v4/);
  assert.match(workflow, /uses:\s*actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\s+# v4/);
  for (const command of ["npm ci", "npm test", "npm run validate"]) assert.ok(workflow.includes(command));
  assert.match(workflow, /if:\s*github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /npm run qualify/);
  assert.doesNotMatch(workflow, /secrets\.|permissions:\s*write|npm publish|deploy/i);

  const governance = await validateReleaseGovernance();
  assert.equal(governance.version, manifest.version);
  assert.equal(governance.workflow.node, 20);
});

test("Tailwind scans only product sources so sparse marketplace builds stay reproducible", async () => {
  for (const stylesheet of ["global.css", "board.css"]) {
    const source = await readFile(new URL(`../src/styles/${stylesheet}`, import.meta.url), "utf8");
    assert.match(source, /^@import "tailwindcss" source\(none\);/);
    assert.match(source, /^@source "\.\.\/\*\*\/\*\.js";$/m);
    assert.match(source, /^@source "\.\.\/\.\.\/panel\/\*\.html";$/m);
    assert.match(source, /^@source "\.\.\/\.\.\/board\/\*\.html";$/m);
    assert.equal([...source.matchAll(/^@source /gm)].length, 3);
  }
});
