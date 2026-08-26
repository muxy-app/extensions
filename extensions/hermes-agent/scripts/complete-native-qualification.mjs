import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const activePath = resolve(root, ".qualification/active.json");
const observationsPath = resolve(root, ".qualification/native-observations.json");

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertOwnedPath(taskRoot, candidate) {
  const ownedRoot = `${resolve(taskRoot)}${sep}`;
  const path = resolve(candidate);
  assert.ok(path.startsWith(ownedRoot), "native verifier path escaped its task root");
  return path;
}

function inspectPng(bytes) {
  assert.ok(bytes.length >= 24, "screenshot is too short");
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "screenshot is not a PNG");
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR", "screenshot has no PNG IHDR");
  return Object.freeze({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
}

const active = JSON.parse(await readFile(activePath, "utf8"));
assert.equal(active.schema, "hermes-agent-active-lab-v1");
const observations = JSON.parse(await readFile(observationsPath, "utf8"));
assert.equal(observations.schema, "hermes-agent-native-observations-v1");
assert.equal(observations.muxyVersion, "1.5.0 (945)");
assert.deepEqual([...new Set(observations.categories)].sort(), [...active.requiredNativeCategories].sort());
assert.equal(observations.claims?.privacyScan, true);
assert.equal(observations.claims?.workspacePathAbsent, true);
assert.equal(observations.claims?.remoteSecretAbsent, true);

const screenshots = {};
for (const [key, relativePath] of Object.entries(active.requiredScreenshots)) {
  const bytes = await readFile(resolve(root, relativePath));
  const dimensions = inspectPng(bytes);
  assert.equal(dimensions.width, 1600, `${relativePath} must be 1600px wide`);
  assert.equal(dimensions.height, 1000, `${relativePath} must be 1000px high`);
  screenshots[key] = Object.freeze({
    path: relativePath,
    sha256: digest(bytes),
    ...dimensions,
  });
}

const challengeFile = assertOwnedPath(active.taskRoot, active.challengeFile);
const nativeResultFile = assertOwnedPath(active.taskRoot, active.nativeResultFile);
const challenge = await readFile(challengeFile, "utf8");
const result = Object.freeze({
  schema: "hermes-agent-native-observation-v1",
  task: active.task,
  challengeDigest: digest(challenge),
  muxyVersion: observations.muxyVersion,
  categories: Object.freeze([...active.requiredNativeCategories]),
  claims: Object.freeze({ ...observations.claims }),
  screenshots: Object.freeze(screenshots),
});
await writeFile(nativeResultFile, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
await chmod(nativeResultFile, 0o600);
console.log(JSON.stringify({ ok: true, task: active.task }));
