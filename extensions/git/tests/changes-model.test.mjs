import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStatus } from "@/core/status";
import { buildRows } from "@/panel/changes/model";

const status = normalizeStatus({
  branch: "main",
  aheadBehind: {},
  stagedFiles: [{ path: "src/a.js", status: "M" }],
  unstagedFiles: [
    { path: "src/lib/deep/x.js", status: "M" },
    { path: "src/lib/deep/y.js", status: "?" },
    { path: "README.md", status: "M" },
  ],
});

test("list rows have a section header followed by files", () => {
  const rows = buildRows(status);
  assert.deepEqual(rows.map((r) => r.key), ["s:staged", "f:staged:src/a.js", "s:unstaged", "f:unstaged:README.md", "f:unstaged:src/lib/deep/x.js", "f:unstaged:src/lib/deep/y.js"]);
});

test("tree rows compact single-child folders and list folders first", () => {
  const rows = buildRows(status, { tree: true }).filter((r) => r.section === "unstaged");
  assert.deepEqual(rows.map((r) => [r.type, r.name ?? r.entry?.name, r.depth]), [
    ["section", undefined, undefined],
    ["folder", "src/lib/deep", 0],
    ["file", "x.js", 1],
    ["file", "y.js", 1],
    ["file", "README.md", 0],
  ]);
  assert.equal(rows[1].entries.length, 2);
});

test("collapsed sections and folders hide their children", () => {
  const rows = buildRows(status, { tree: true, collapsed: new Set(["s:staged", "d:unstaged:src/lib/deep"]) });
  assert.deepEqual(rows.map((r) => r.key), ["s:staged", "s:unstaged", "d:unstaged:src/lib/deep", "f:unstaged:README.md"]);
});

test("filter matches paths across sections and drops empty sections", () => {
  const rows = buildRows(status, { filter: "deep/Y" });
  assert.deepEqual(rows.map((r) => r.key), ["s:unstaged", "f:unstaged:src/lib/deep/y.js"]);
  assert.equal(rows[0].count, 1);
});
