import { test } from "node:test";
import assert from "node:assert/strict";
import { splitFrontmatter, parseYamlSubset } from "../src/core/frontmatter.js";

test("splitFrontmatter extracts nested maps, arrays, and scalars", () => {
  const { data, body, hasFrontmatter } = splitFrontmatter(`---
gsd_state_version: '1.0'
milestone: v1.1
status: active
progress:
  total_phases: 4
  completed_phases: 2
  percent: 50
tags: [muxy, gsd]
empty:
requires:
---

# Body here
`);
  assert.equal(hasFrontmatter, true);
  assert.equal(data.gsd_state_version, "1.0");
  assert.equal(data.milestone, "v1.1");
  assert.equal(data.status, "active");
  assert.deepEqual(data.progress, { total_phases: 4, completed_phases: 2, percent: 50 });
  assert.deepEqual(data.tags, ["muxy", "gsd"]);
  assert.equal(data.empty, null);
  assert.equal(data.requires, null);
  assert.match(body, /^\s*# Body here/);
});

test("documents without frontmatter pass through untouched", () => {
  const res = splitFrontmatter("# Just a doc\n- item\n");
  assert.equal(res.hasFrontmatter, false);
  assert.deepEqual(res.data, {});
});

test("scalar coercion covers booleans, numbers, quoted strings", () => {
  const parsed = parseYamlSubset(`
flag_true: true
flag_false: false
count: 42
float: 1.5
quoted: "hello world"
single: 'single'
bare: bare-token
iso: "2026-08-22T19:41:28.892Z"
`);
  assert.equal(parsed.flag_true, true);
  assert.equal(parsed.flag_false, false);
  assert.equal(parsed.count, 42);
  assert.equal(parsed.float, 1.5);
  assert.equal(parsed.quoted, "hello world");
  assert.equal(parsed.single, "single");
  assert.equal(parsed.bare, "bare-token");
  assert.equal(parsed.iso, "2026-08-22T19:41:28.892Z");
});
