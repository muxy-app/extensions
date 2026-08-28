import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

test("mapped-board recovery preserves its specific guidance", async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  const previousWindow = globalThis.window;
  try {
    const [{ HermesProjectBoard }, { KanbanClientError }] = await Promise.all([
      vite.ssrLoadModule("/src/board/app.js"),
      vite.ssrLoadModule("/src/kanban-client.js"),
    ]);
    globalThis.window = { muxy: { tabs: { async setTitle() {} } } };
    const cleared = [];
    const board = new HermesProjectBoard({});
    board.render = () => {};
    board.activeProject = { id: "project-a", name: "Project A" };
    board.boardValue = "alpha";
    board.viewedBoardValue = "alpha";
    board.mappedBoardValue = "alpha";
    board.client = {
      setBoard() {},
      async loadBoard() { throw new KanbanClientError("kanban_not_available", 404); },
      async listBoards() { return { boards: [{ slug: "beta", name: "Beta" }], current: "beta" }; },
    };
    board.sessionBroker = {
      async clearBoardMapping(value) { cleared.push(value); return true; },
    };

    await board.openBoard();

    assert.deepEqual(cleared, [{ projectID: "project-a" }]);
    assert.equal(board.state, "board_picker");
    assert.equal(board.message, "That mapped board is no longer available. Choose another board.");
    assert.equal(board.mappedBoardValue, null);
    assert.equal(board.boardValue, "beta");
  } finally {
    globalThis.window = previousWindow;
    await vite.close();
  }
});

test("blocked and done moves explicitly default to cancellation", async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  const previousWindow = globalThis.window;
  try {
    const { HermesProjectBoard } = await vite.ssrLoadModule("/src/board/app.js");
    const confirmations = [];
    globalThis.window = {
      muxy: {
        dialog: {
          async confirm(options) { confirmations.push(options); return "Cancel"; },
        },
      },
    };
    let updates = 0;
    const board = new HermesProjectBoard({});
    board.render = () => {};
    board.client = {
      async updateStatus() { updates += 1; },
      async loadBoard() { return {}; },
    };

    await board.moveCard({ id: "task-1", title: "Review release", status: "review" }, "done");

    assert.deepEqual(confirmations, [{
      title: "Move card to Done?",
      message: "Review release",
      buttons: ["Cancel", "Move"],
      default: "Cancel",
      cancel: "Cancel",
      style: "warning",
    }]);
    assert.equal(updates, 0);
  } finally {
    globalThis.window = previousWindow;
    await vite.close();
  }
});
