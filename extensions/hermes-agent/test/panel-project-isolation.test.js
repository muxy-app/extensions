import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

test("an operations refresh cannot publish after the active project changes", async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  const previousWindow = globalThis.window;
  try {
    const { HermesGatewayPanel } = await vite.ssrLoadModule("/src/panel/app.js");
    let activeProject = { id: "project-a", name: "Project A", isActive: true };
    const projectBMapping = deferred();
    const pending = [];
    const operations = {
      board: "alpha",
      setBoard(board) { this.board = board; },
      load() {
        const request = deferred();
        pending.push({ board: this.board, ...request });
        return request.promise;
      },
    };
    globalThis.window = {
      muxy: {
        projects: { async list() { return [activeProject]; } },
      },
    };

    const panel = new HermesGatewayPanel({});
    panel.render = () => {};
    panel.authSnapshot = Object.freeze({ state: "logged_in" });
    panel.authSession = { baseUrl: "https://hermes.example" };
    panel.operations = operations;
    panel.operationsSnapshot = Object.freeze({ state: "ready", updatedAt: 1, queue: { project: "A" } });
    panel.persistDashboardSession = async () => true;
    panel.sessionBroker = {
      async readBoardMapping({ projectID }) {
        return projectID === "project-a" ? { board: "alpha" } : projectBMapping.promise;
      },
    };

    const projectARefresh = panel.refreshOperations();
    assert.equal(pending[0].board, "alpha");

    activeProject = { id: "project-b", name: "Project B", isActive: true };
    const projectSwitch = panel.syncActiveProjectBoard();
    await Promise.resolve();
    await Promise.resolve();

    pending[0].resolve(Object.freeze({ state: "ready", updatedAt: 2, queue: { project: "A" } }));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(pending[1].board, null, "operations fail closed while the new project mapping is unresolved");
    assert.notEqual(panel.operationsSnapshot.queue?.project, "A");
    assert.equal(panel.operationsRefreshInFlight, true, "the current project request is still active");

    projectBMapping.resolve({ board: "beta" });
    await projectSwitch;
    const projectBRefresh = panel.refreshOperations();
    pending[1].resolve(Object.freeze({ state: "ready", updatedAt: 3, queue: null }));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(pending[2].board, "beta", "the mapped project refresh must follow the fail-closed request");

    pending[2].resolve(Object.freeze({ state: "ready", updatedAt: 4, queue: { project: "B" } }));
    await Promise.all([projectARefresh, projectBRefresh]);
    assert.equal(panel.operationsSnapshot.queue.project, "B");
    assert.equal(panel.operationsRefreshInFlight, false);
  } finally {
    globalThis.window = previousWindow;
    await vite.close();
  }
});
