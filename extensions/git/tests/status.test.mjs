import { test } from "node:test";
import assert from "node:assert/strict";
import { changeCount, fileCode, normalizeStatus, parsePorcelain, statusKey } from "@/core/status";

test("fileCode maps porcelain codes", () => {
  assert.equal(fileCode("?", false), "U");
  assert.equal(fileCode("??", false), "U");
  assert.equal(fileCode("UU", true), "!");
  assert.equal(fileCode("AA", false), "!");
  assert.equal(fileCode("M", true), "M");
  assert.equal(fileCode("MD", true), "M");
  assert.equal(fileCode("MD", false), "D");
  assert.equal(fileCode("", false), "M");
});

test("normalizeStatus splits conflicts out of staged and unstaged", () => {
  const status = normalizeStatus({
    branch: "main",
    defaultBranch: "main",
    aheadBehind: { ahead: 2, behind: 1 },
    stagedFiles: [{ path: "b.js", status: "M", additions: 3, deletions: 1 }, { path: "c.js", status: "U" }],
    unstagedFiles: [{ path: "a/x.js", status: "?" }, { path: "c.js", status: "U" }, { path: "d.js", status: "D", oldPath: "d.js" }],
  });
  assert.deepEqual(status.conflicts.map((e) => e.path), ["c.js"]);
  assert.deepEqual(status.staged.map((e) => [e.path, e.code, e.additions]), [["b.js", "M", 3]]);
  assert.deepEqual(status.unstaged.map((e) => [e.path, e.code, e.dir, e.name]), [["a/x.js", "U", "a", "x.js"], ["d.js", "D", "", "d.js"]]);
  assert.equal(status.unstaged[1].oldPath, null);
  assert.equal(status.ahead, 2);
  assert.equal(changeCount(status), 4);
});

test("parsePorcelain reads branch, renames, conflicts and untracked files", () => {
  const text = ["## feature...origin/feature [ahead 3, behind 2]", "R  new.js", "old.js", " M mod.js", "MM both.js", "UU conflict.js", "?? dir/new.txt", "!! ignored", ""].join("\0");
  const status = parsePorcelain(text);
  assert.equal(status.branch, "feature");
  assert.equal(status.ahead, 3);
  assert.equal(status.behind, 2);
  assert.equal(status.limited, true);
  assert.deepEqual(status.staged.map((e) => [e.path, e.code, e.oldPath]), [["both.js", "M", null], ["new.js", "R", "old.js"]]);
  assert.deepEqual(status.unstaged.map((e) => [e.path, e.code]), [["both.js", "M"], ["dir/new.txt", "U"], ["mod.js", "M"]]);
  assert.deepEqual(status.conflicts.map((e) => e.path), ["conflict.js"]);
});

test("parsePorcelain handles unborn and detached heads", () => {
  assert.equal(parsePorcelain("## No commits yet on main\0?? a\0").branch, "main");
  assert.equal(parsePorcelain("## HEAD (no branch)\0").branch, null);
});

test("statusKey changes only when visible state changes", () => {
  const base = { branch: "main", aheadBehind: { ahead: 0, behind: 0 }, stagedFiles: [], unstagedFiles: [{ path: "a", status: "M", additions: 1, deletions: 0 }] };
  const a = statusKey(normalizeStatus(base));
  assert.equal(a, statusKey(normalizeStatus(structuredClone(base))));
  base.unstagedFiles[0].additions = 2;
  assert.notEqual(a, statusKey(normalizeStatus(base)));
});
