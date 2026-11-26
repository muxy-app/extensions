import assert from "node:assert/strict";
import test from "node:test";

import { compareSemver, parseSemver } from "./semver.mjs";

test("compareSemver orders versions numerically, not as strings", () => {
  assert.equal(compareSemver("1.10.0", "1.9.0"), 1);
  assert.equal(compareSemver("2.0.0", "10.0.0"), -1);
  assert.equal(compareSemver("1.0.10", "1.0.9"), 1);
  assert.equal(compareSemver("1.2.3", "1.2.3"), 0);
});

test("compareSemver follows semver prerelease precedence and ignores build metadata", () => {
  const ascending = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
  ];
  for (let i = 0; i < ascending.length - 1; i += 1) {
    assert.equal(compareSemver(ascending[i], ascending[i + 1]), -1, `${ascending[i]} < ${ascending[i + 1]}`);
    assert.equal(compareSemver(ascending[i + 1], ascending[i]), 1, `${ascending[i + 1]} > ${ascending[i]}`);
  }
  assert.equal(compareSemver("1.0.0+build.1", "1.0.0+build.2"), 0);
});

test("compareSemver rejects anything that is not semver", () => {
  assert.equal(parseSemver("1.0"), null);
  assert.equal(parseSemver("01.0.0"), null);
  assert.equal(parseSemver("v1.0.0"), null);
  assert.throws(() => compareSemver("1.0", "1.0.0"));
});
