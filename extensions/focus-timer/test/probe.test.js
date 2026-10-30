import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseProbe, parseStateRead, isMuxyFrontmost } from "../src/shared/probe.js";

const fixture = (name) => readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8");

test("parses a real local probe capture", () => {
  const parsed = parseProbe(fixture("probe-local.txt"));
  assert.equal(parsed.idleNs, 20986586250);
  assert.equal(parsed.frontmost, "com.muxy.app");
});

test("remote host (no ioreg, no lsappinfo) parses to nulls", () => {
  const parsed = parseProbe(fixture("probe-remote.txt"));
  assert.equal(parsed.idleNs, null);
  assert.equal(parsed.frontmost, null);
});

test("idle without frontmost (headless lsappinfo) keeps idle only", () => {
  const parsed = parseProbe(fixture("probe-no-front.txt"));
  assert.equal(parsed.idleNs, 123456789);
  assert.equal(parsed.frontmost, null);
});

test("garbage input never throws", () => {
  assert.deepEqual(parseProbe(""), { idleNs: null, frontmost: null });
  assert.deepEqual(parseProbe(null), { idleNs: null, frontmost: null });
  assert.deepEqual(parseProbe("error: nope"), { idleNs: null, frontmost: null });
});

test("isMuxyFrontmost matches the com.muxy. prefix (beta builds included)", () => {
  assert.equal(isMuxyFrontmost("com.muxy.app"), true);
  assert.equal(isMuxyFrontmost("com.muxy.app.beta"), true);
  assert.equal(isMuxyFrontmost("com.apple.Safari"), false);
  assert.equal(isMuxyFrontmost(null), false);
});

test("parseStateRead: local marker plus JSON", () => {
  const { local, state } = parseStateRead('@@LOCAL@@\n{"v":1,"savedAt":42}');
  assert.equal(local, true);
  assert.equal(state.savedAt, 42);
});

test("parseStateRead: local marker, no file yet", () => {
  const { local, state } = parseStateRead("@@LOCAL@@\n");
  assert.equal(local, true);
  assert.equal(state, null);
});

test("parseStateRead: not local — result is not authoritative", () => {
  const { local, state } = parseStateRead("");
  assert.equal(local, false);
  assert.equal(state, null);
});

test("parseStateRead: corrupt JSON degrades to null", () => {
  const { local, state } = parseStateRead("@@LOCAL@@\n{broken");
  assert.equal(local, true);
  assert.equal(state, null);
});
