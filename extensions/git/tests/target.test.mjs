import test from "node:test";
import assert from "node:assert/strict";
import { parseProbe, pickPane } from "@/core/target";
import { parseWorktrees } from "@/core/git";

test("parseProbe reads root and git dir", () => {
  assert.deepEqual(parseProbe("/a/b\n/a/b/.git\n"), { root: "/a/b", gitDir: "/a/b/.git", isWorktree: false });
  assert.equal(parseProbe("/a/wt\n/a/.git/worktrees/wt\n").isWorktree, true);
  assert.equal(parseProbe(""), null);
});

test("pickPane prefers the focused pane of the active worktree", () => {
  const panes = [
    { id: 1, worktreeID: "x", isFocused: false },
    { id: 2, worktreeID: "y", isFocused: true },
    { id: 3, worktreeID: "y", isFocused: false },
  ];
  assert.equal(pickPane(panes, "y").id, 2);
  assert.equal(pickPane(panes, "x").id, 1);
  assert.equal(pickPane([], "x"), null);
  assert.equal(pickPane(panes, "z"), null);
  assert.equal(pickPane(panes, null).id, 2);
});

test("parseWorktrees reads porcelain output", () => {
  const out = "worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r-wt\nHEAD def\ndetached\n";
  assert.deepEqual(parseWorktrees(out), [
    { path: "/r", branch: "main" },
    { path: "/r-wt", branch: null },
  ]);
});
