import assert from "node:assert/strict";
import test from "node:test";

import { selectBoardSlug } from "../src/kanban-client.js";

const catalog = Object.freeze({
  boards: Object.freeze([
    Object.freeze({ slug: "alpha", name: "Alpha", description: null, total: 0, isCurrent: false }),
    Object.freeze({ slug: "bravo", name: "Bravo", description: null, total: 2, isCurrent: true }),
  ]),
  current: "bravo",
});

test("board picker favors a still-available saved board, then Hermes current, then first", () => {
  assert.equal(selectBoardSlug(catalog, "alpha"), "alpha");
  assert.equal(selectBoardSlug(catalog, "removed-board"), "bravo");
  assert.equal(selectBoardSlug({ ...catalog, current: null }, null), "alpha");
});

test("board picker leaves an empty catalog unselected and never invents a board", () => {
  assert.equal(selectBoardSlug({ boards: [], current: "default" }, "default"), null);
  assert.equal(selectBoardSlug({ boards: [{ slug: "only", name: "Only", description: null, total: 0, isCurrent: false }], current: null }), "only");
});
