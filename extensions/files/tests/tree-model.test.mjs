import assert from "node:assert/strict";
import test from "node:test";
import { TreeModel, compare_entries, entry_from_host } from "@/panel/model";

const host = (path, isDirectory = false, isIgnored = false) =>
  entry_from_host({ name: path.split("/").at(-1), path, isDirectory, isIgnored });

function project() {
  const model = new TreeModel();
  model.setChildren("", [host("src", true), host("node_modules", true, true), host("README.md")]);
  model.setChildren("src/", [host("src/lib", true), host("src/main.js")]);
  model.setChildren("src/lib/", [host("src/lib/a.js")]);
  return model;
}

const paths = (rows) => rows.map((row) => row.path);

test("host entries become folder paths with depth", () => {
  const entry = host("src/lib", true);
  assert.equal(entry.path, "src/lib/");
  assert.equal(entry.dir, true);
  assert.equal(entry.depth, 1);
  assert.equal(host("README.md").depth, 0);
});

test("flatten shows children of expanded folders only", () => {
  const model = project();
  assert.deepEqual(paths(model.flatten()), ["src/", "node_modules/", "README.md"]);
  model.expanded.add("src/");
  assert.deepEqual(paths(model.flatten()), ["src/", "src/lib/", "src/main.js", "node_modules/", "README.md"]);
  model.expanded.add("src/lib/");
  assert.deepEqual(paths(model.flatten()), ["src/", "src/lib/", "src/lib/a.js", "src/main.js", "node_modules/", "README.md"]);
  assert.equal(model.indexOf("src/main.js"), 3);
  // Collapsing a parent hides an expanded child folder but remembers it.
  model.expanded.delete("src/");
  assert.deepEqual(paths(model.flatten()), ["src/", "node_modules/", "README.md"]);
  assert.equal(model.expanded.has("src/lib/"), true);
});

test("an identical listing is a no-op and keeps entry identity", () => {
  const model = project();
  const before = model.get("src/main.js");
  assert.equal(model.setChildren("src/", [host("src/lib", true), host("src/main.js")]), false);
  assert.equal(model.get("src/main.js"), before);
  assert.equal(model.setChildren("src/", [host("src/lib", true), host("src/main.js"), host("src/new.js")]), true);
  assert.equal(model.get("src/main.js"), before);
});

test("entries that vanish from a listing take their subtree with them", () => {
  const model = project();
  model.expanded.add("src/");
  model.expanded.add("src/lib/");
  model.setChildren("src/", [host("src/main.js")]);
  assert.equal(model.isLoaded("src/lib/"), false);
  assert.equal(model.get("src/lib/a.js"), null);
  assert.equal(model.expanded.has("src/lib/"), false);
});

test("insert keeps the host's folders-first, case-insensitive order", () => {
  const model = project();
  model.insert(host("src/Zeta.js"));
  model.insert(host("src/alpha.js"));
  model.insert(host("src/aaa", true));
  assert.deepEqual(
    model.children.get("src/").map((e) => e.name),
    ["aaa", "lib", "alpha.js", "main.js", "Zeta.js"],
  );
  assert.ok(compare_entries(host("b", true), host("a")) < 0);
});

test("remove and moveExpanded support optimistic renames", () => {
  const model = project();
  model.expanded.add("src/");
  model.expanded.add("src/lib/");
  model.moveExpanded("src/lib/", "src/util/");
  assert.equal(model.expanded.has("src/util/"), true);
  assert.equal(model.expanded.has("src/lib/"), false);
  model.remove("src/lib/");
  assert.deepEqual(model.children.get("src/").map((e) => e.path), ["src/main.js"]);
});

test("a draft row appears first inside its folder", () => {
  const model = project();
  model.expanded.add("src/");
  model.setDraft("src/", "file");
  const rows = model.flatten();
  assert.equal(rows[1].draft, "file");
  assert.equal(rows[1].depth, 1);
  model.setDraft(null);
  assert.equal(model.flatten().some((row) => row.draft), false);
});

test("a filter replaces expansion for the changed-files view", () => {
  const model = project();
  const changed = new Set(["src/", "src/lib/", "src/lib/a.js"]);
  const rows = model.flatten({ visible: (e) => changed.has(e.path), open: () => true });
  assert.deepEqual(paths(rows), ["src/", "src/lib/", "src/lib/a.js"]);
});

test("isUnderIgnored walks up to an ignored folder", () => {
  const model = project();
  assert.equal(model.isUnderIgnored("node_modules/x/index.js"), true);
  assert.equal(model.isUnderIgnored("src/main.js"), false);
  assert.equal(model.isUnderIgnored("unknown/x.js"), false);
});

test("flatten reports open folders on screen that have no listing yet", () => {
  const model = project();
  model.setChildren("src/lib/", [host("src/lib/a.js"), host("src/lib/deep", true)]);
  model.expanded.add("src/lib/deep/");
  // Its parents are collapsed, so it isn't on screen yet.
  model.flatten();
  assert.deepEqual(model.missing, []);
  model.expanded.add("src/");
  model.expanded.add("src/lib/");
  model.flatten();
  assert.deepEqual(model.missing, ["src/lib/deep/"]);
});
