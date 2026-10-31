import assert from "node:assert/strict";
import test from "node:test";
import { build_git_index } from "@/panel/git";

test("files keep their status letter; folders fold their contents", () => {
  const index = build_git_index({
    stagedFiles: [{ path: "src/a.js", status: "A" }],
    unstagedFiles: [
      { path: "src/a.js", status: "M" },
      { path: "src/new/b.js", status: "?" },
      { path: "docs/x.md", status: "D" },
      { path: "conflict.txt", status: "U" },
    ],
  });
  // Modified outranks added for the same file.
  assert.equal(index.files.get("src/a.js"), "M");
  assert.equal(index.files.get("src/new/b.js"), "?");
  assert.equal(index.files.get("conflict.txt"), "M");
  assert.equal(index.folders.get("src/"), "M");
  assert.equal(index.folders.get("src/new/"), "?");
  assert.equal(index.folders.get("docs/"), "M");
  assert.equal(index.folders.has(""), false);
});

test("the index key changes only when the status does", () => {
  const status = { unstagedFiles: [{ path: "b", status: "M" }, { path: "a", status: "?" }] };
  const reordered = { unstagedFiles: [{ path: "a", status: "?" }, { path: "b", status: "M" }] };
  assert.equal(build_git_index(status).key, build_git_index(reordered).key);
  assert.notEqual(build_git_index(status).key, build_git_index({ unstagedFiles: [{ path: "b", status: "M" }] }).key);
  assert.equal(build_git_index(null).files.size, 0);
});
