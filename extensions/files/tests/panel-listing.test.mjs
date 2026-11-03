import assert from "node:assert/strict";
import test from "node:test";
import { FilesPanel } from "@/panel/panel";

function linked_project() {
  const panel = new FilesPanel(null);
  const target = "cache/is-number@6.0.0@@@1";
  const link = "cache/is-number/6.0.0@@@1";
  const item = (path, isDirectory = false) => ({ name: path.split("/").at(-1), path, isDirectory });
  const children = ["index.js", "LICENSE", "package.json", "README.md"].map((name) => item(`${target}/${name}`));
  const listings = new Map([
    ["", [item("cache", true)]],
    ["cache", [item("cache/is-number", true), item(target, true)]],
    ["cache/is-number", [item(link, true)]],
    [link, children],
    [target, children],
  ]);
  const calls = [];
  globalThis.muxy = {
    files: {
      list: async (path) => {
        calls.push(path);
        assert.ok(listings.has(path), `Unexpected listing: ${path}`);
        return listings.get(path);
      },
    },
  };
  return { panel, target, link, listings, calls };
}

test("expanding a symlink and its target keeps separate rows at the correct depth", async () => {
  const { panel, target, link, calls } = linked_project();
  const dirs = ["", "cache/", "cache/is-number/", `${link}/`, `${target}/`];
  await Promise.all(dirs.map((dir) => panel.load(dir)));
  for (const dir of dirs) panel.model.expanded.add(dir);

  const rows = panel.model.flatten();
  const names = ["index.js", "LICENSE", "package.json", "README.md"];
  assert.deepEqual(rows.map((row) => row.path), [
    "cache/", "cache/is-number/", `${link}/`,
    ...names.map((name) => `${link}/${name}`),
    `${target}/`, ...names.map((name) => `${target}/${name}`),
  ]);
  assert.equal(panel.model.index.size, rows.length);
  for (const name of names) {
    assert.equal(panel.model.get(`${link}/${name}`).depth, 3);
    assert.equal(panel.model.get(`${target}/${name}`).depth, 2);
    assert.notEqual(panel.model.get(`${link}/${name}`), panel.model.get(`${target}/${name}`));
  }
  assert.deepEqual(calls, dirs.map((dir) => dir.replace(/\/$/, "")));

  panel.model.expanded.delete(`${link}/`);
  assert.equal(panel.model.flatten().length, 8);
  panel.model.expanded.add(`${link}/`);
  assert.equal(panel.model.flatten().length, 12);

  const targetFile = panel.model.get(`${target}/index.js`);
  panel.model.remove(`${link}/`);
  assert.equal(panel.model.get(`${link}/index.js`), null);
  assert.equal(panel.model.get(`${target}/index.js`), targetFile);
});

test("nested symlink listings stay attached to their displayed parents on refresh", async () => {
  const { panel, target, link, listings, calls } = linked_project();
  listings.get(link).unshift({ name: "lib", path: `${target}/lib`, isDirectory: true });
  listings.set(`${link}/lib`, [{ name: "a.js", path: `${target}/lib/a.js`, isDirectory: false }]);

  await panel.load(`${link}/`);
  const folder = panel.model.get(`${link}/lib/`);
  assert.ok(folder);
  await panel.load(folder.path);
  const file = panel.model.get(`${link}/lib/a.js`);
  assert.equal(file.depth, 4);
  assert.deepEqual(calls, [link, `${link}/lib`]);
  assert.equal(await panel.load(`${link}/`), false);
  assert.equal(panel.model.get(`${link}/lib/`), folder);
  assert.equal(panel.model.get(`${link}/lib/a.js`), file);
  assert.equal(panel.model.isLoaded(`${link}/lib/`), true);
});
