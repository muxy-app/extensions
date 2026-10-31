import assert from "node:assert/strict";
import test from "node:test";
import {
  ancestors_of,
  basename,
  changed_rel,
  depth_of,
  dir_path,
  is_within,
  parent_of,
  resolve_rel,
  split_name,
} from "@/shared/paths";

test("folder paths end in a slash and the root is empty", () => {
  assert.equal(dir_path("src"), "src/");
  assert.equal(dir_path("src///"), "src/");
  assert.equal(dir_path(""), "");
  assert.equal(parent_of("src/lib/a.js"), "src/lib/");
  assert.equal(parent_of("src/lib/"), "src/");
  assert.equal(parent_of("a.js"), "");
  assert.equal(basename("src/lib/"), "lib");
  assert.equal(depth_of(""), 0);
  assert.equal(depth_of("src/"), 1);
  assert.equal(depth_of("src/lib/a.js"), 3);
  assert.deepEqual(ancestors_of("a/b/c.txt"), ["a/", "a/b/"]);
  assert.equal(is_within("a/b/c", "a/"), true);
  assert.equal(is_within("a/", "a/"), false);
  assert.equal(is_within("ab/c", "a/"), false);
});

test("split_name selects up to the extension like Finder", () => {
  assert.deepEqual(split_name("index.test.js", false), { stem: "index.test", ext: ".js" });
  assert.deepEqual(split_name(".gitignore", false), { stem: ".gitignore", ext: "" });
  assert.deepEqual(split_name("my.folder", true), { stem: "my.folder", ext: "" });
});

test("resolve_rel follows ./ and ../ from the linking file", () => {
  assert.equal(resolve_rel("docs/guide/a.md", "../img/x.png"), "docs/img/x.png");
  assert.equal(resolve_rel("a.md", "../x"), null);
  assert.equal(resolve_rel("a.md", "/abs"), null);
});

test("changed_rel maps absolute file.changed payloads to project paths", () => {
  const root = "/Users/me/project";
  assert.equal(changed_rel({ path: `${root}/src/a.js`, projectPath: root }, root), "src/a.js");
  assert.equal(changed_rel({ path: `${root}/src/`, projectPath: `${root}/` }, root), "src");
  // A rescan reports the root itself.
  assert.equal(changed_rel({ path: root, projectPath: root }, root), "");
  // Other projects (with editor tabs open) are not ours.
  assert.equal(changed_rel({ path: "/Users/me/other/src/a.js", projectPath: "/Users/me/other" }, root), null);
  // A sibling folder sharing the prefix is not inside the project.
  assert.equal(changed_rel({ path: `${root}-2/a.js`, projectPath: root }, root), null);
  // Without a known root, the payload's own project is used.
  assert.equal(changed_rel({ path: "/x/y/README.md", projectPath: "/x/y" }), "README.md");
  assert.equal(changed_rel({}), null);
  assert.equal(changed_rel(null), null);
});
