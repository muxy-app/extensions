import { test } from "node:test";
import assert from "node:assert/strict";
import { baseOptions } from "@/create-pr/bases";
import { buildRows, visibleCollapsed } from "@/panel/changes/model";

test("a PR started from the default branch keeps the default branch as a target", () => {
  assert.deepEqual(baseOptions(["main", "unrelated-feature"], "main", "main"), ["main", "unrelated-feature"]);
  assert.deepEqual(baseOptions(["main", "feature"], "feature", "main"), ["main"]);
});

test("a collapsed section whose header is hidden still shows its files", () => {
  const groups = { staged: [], unstaged: [{ path: "a.js", name: "a.js", dir: "", code: "M" }] };
  const sections = [{ id: "staged", label: "Staged" }, { id: "unstaged", label: "Changes" }];
  const collapsed = new Set(["s:unstaged"]);
  const rows = buildRows(groups, { collapsed: visibleCollapsed(collapsed, false), sections }).filter((row) => row.type !== "section");
  assert.deepEqual(rows.map((row) => row.key), ["f:unstaged:a.js"]);
  assert.equal(buildRows(groups, { collapsed: visibleCollapsed(collapsed, true), sections }).length, 1);
});
