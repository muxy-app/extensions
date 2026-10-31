import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGraph } from "@/core/graph";

const c = (hash, ...parents) => ({ hash, parents });

test("linear history stays in one lane without a line above the tip", () => {
  const rows = computeGraph([c("c", "b"), c("b", "a"), c("a")]);
  assert.deepEqual(rows.map((r) => [r.col, r.hasChild, r.edges]), [[0, false, [0]], [0, true, [0]], [0, true, []]]);
});

test("a merge opens a second lane that rejoins at the fork point", () => {
  const rows = computeGraph([c("m", "a2", "b1"), c("b1", "base"), c("a2", "base"), c("base")]);
  assert.deepEqual(rows[0].edges, [0, 1]);
  assert.equal(rows[1].col, 1);
  assert.deepEqual(rows[1].pass, [0]);
  assert.equal(rows[2].col, 0);
  assert.deepEqual(rows[2].pass, [1]);
  assert.equal(rows[3].col, 0);
  assert.deepEqual(rows[3].joins, [1]);
});

test("branches that share a parent converge instead of duplicating lanes", () => {
  const rows = computeGraph([c("x", "p"), c("y", "p"), c("p")]);
  assert.deepEqual(rows[1].edges, [0]);
  assert.equal(rows[2].col, 0);
  assert.equal(Math.max(...rows.map((r) => r.width)), 2);
});
