import assert from "node:assert/strict";
import test from "node:test";
import { reconcile_children } from "../src/lib/list-reconcile.js";

class FakeNode {
  constructor(key) {
    this.key = key;
    this.nextSibling = null;
  }
}

class FakeParent {
  constructor(keys = []) {
    this.children = keys.map((key) => new FakeNode(key));
    this.mutations = 0;
    this.link();
  }

  link() {
    this.children.forEach((node, index) => {
      node.nextSibling = this.children[index + 1] ?? null;
    });
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  node(key) {
    return this.children.find((child) => child.key === key) ?? new FakeNode(key);
  }

  insertBefore(node, ref) {
    const current = this.children.indexOf(node);
    if (current !== -1) this.children.splice(current, 1);
    const at = ref === null ? this.children.length : this.children.indexOf(ref);
    this.children.splice(at === -1 ? this.children.length : at, 0, node);
    this.mutations += 1;
    this.link();
  }

  removeChild(node) {
    this.children.splice(this.children.indexOf(node), 1);
    this.mutations += 1;
    this.link();
  }

  get keys() {
    return this.children.map((child) => child.key);
  }
}

function run(start, want) {
  const parent = new FakeParent(start);
  const pool = new Map(parent.children.map((child) => [child.key, child]));
  const nodes = want.map((key) => {
    if (!pool.has(key)) pool.set(key, new FakeNode(key));
    return pool.get(key);
  });
  parent.mutations = 0;
  reconcile_children(parent, nodes);
  return parent;
}

test("an unchanged list is not touched at all", () => {
  const parent = run(["a", "b", "c"], ["a", "b", "c"]);
  assert.deepEqual(parent.keys, ["a", "b", "c"]);
  assert.equal(parent.mutations, 0);
});

test("expanding inserts only the new rows", () => {
  const parent = run(["a", "d"], ["a", "b", "c", "d"]);
  assert.deepEqual(parent.keys, ["a", "b", "c", "d"]);
  assert.equal(parent.mutations, 2);
});

test("collapsing removes only the departed rows", () => {
  const parent = run(["a", "b", "c", "d"], ["a", "d"]);
  assert.deepEqual(parent.keys, ["a", "d"]);
  assert.equal(parent.mutations, 2);
});

test("a row removed from the middle costs one mutation", () => {
  const parent = run(["a", "b", "c"], ["a", "c"]);
  assert.deepEqual(parent.keys, ["a", "c"]);
  assert.equal(parent.mutations, 1);
});

test("surviving rows keep their identity across a reconcile", () => {
  const parent = new FakeParent(["a", "b", "c"]);
  const kept = parent.node("b");
  const nodes = ["a", "b", "c", "d"].map((key) => (key === "d" ? new FakeNode("d") : parent.node(key)));
  reconcile_children(parent, nodes);
  assert.equal(parent.node("b"), kept);
});

test("prepending, appending and emptying stay correct", () => {
  assert.deepEqual(run(["b", "c"], ["a", "b", "c"]).keys, ["a", "b", "c"]);
  assert.deepEqual(run(["a", "b"], ["a", "b", "c"]).keys, ["a", "b", "c"]);
  assert.deepEqual(run(["a", "b"], []).keys, []);
  assert.deepEqual(run([], ["a", "b"]).keys, ["a", "b"]);
});

test("reordering produces the requested order", () => {
  assert.deepEqual(run(["a", "b", "c"], ["c", "b", "a"]).keys, ["c", "b", "a"]);
  assert.deepEqual(run(["a", "b"], ["x", "y"]).keys, ["x", "y"]);
});
