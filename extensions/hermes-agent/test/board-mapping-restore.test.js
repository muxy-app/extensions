import assert from "node:assert/strict";
import test from "node:test";
import { restoreProjectBoardMapping } from "../src/board/mapping-restore.js";
import { SessionBrokerClient } from "../src/session-broker.js";

function extensionStorage() {
  const values = new Map();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => values.set(key, value),
    delete: async (key) => values.delete(key),
  };
}

const boards = Object.freeze([{ slug: "alpha", name: "Alpha" }, { slug: "beta", name: "Beta" }]);

test("logout then same-Dashboard sign-in restores the active project's available mapped board", async () => {
  const broker = new SessionBrokerClient({ storage: extensionStorage(), randomId: () => "mapping-test" });
  await broker.saveBoardMapping({ projectID: "project-a", baseUrl: "https://hermes.example", board: "alpha" });

  // Logging out clears only dashboard authentication; a successful same-URL login restores the project mapping.
  await broker.clearDashboard();
  const restored = await restoreProjectBoardMapping({
    sessionBroker: broker,
    projectID: "project-a",
    baseUrl: "https://hermes.example",
    boards,
  });

  assert.deepEqual(restored, { board: "alpha", stale: false });
  assert.deepEqual(await broker.readBoardMapping({ projectID: "project-a", baseUrl: "https://hermes.example" }), {
    baseUrl: "https://hermes.example", board: "alpha",
  });
});

test("alternate Dashboard sign-in never restores or clears the active project's mapping", async () => {
  const broker = new SessionBrokerClient({ storage: extensionStorage(), randomId: () => "mapping-test" });
  await broker.saveBoardMapping({ projectID: "project-a", baseUrl: "https://hermes.example", board: "alpha" });

  const restored = await restoreProjectBoardMapping({
    sessionBroker: broker,
    projectID: "project-a",
    baseUrl: "https://other.example",
    boards,
  });

  assert.deepEqual(restored, { board: null, stale: false });
  assert.deepEqual(await broker.readBoardMapping({ projectID: "project-a", baseUrl: "https://hermes.example" }), {
    baseUrl: "https://hermes.example", board: "alpha",
  });
});

test("missing mapped boards clear only the active project's stale mapping", async () => {
  const broker = new SessionBrokerClient({ storage: extensionStorage(), randomId: () => "mapping-test" });
  await broker.saveBoardMapping({ projectID: "project-a", baseUrl: "https://hermes.example", board: "alpha" });
  await broker.saveBoardMapping({ projectID: "project-b", baseUrl: "https://hermes.example", board: "beta" });

  const restored = await restoreProjectBoardMapping({
    sessionBroker: broker,
    projectID: "project-a",
    baseUrl: "https://hermes.example",
    boards: Object.freeze([{ slug: "beta", name: "Beta" }]),
  });

  assert.deepEqual(restored, { board: null, stale: true });
  assert.equal(await broker.readBoardMapping({ projectID: "project-a", baseUrl: "https://hermes.example" }), null);
  assert.deepEqual(await broker.readBoardMapping({ projectID: "project-b", baseUrl: "https://hermes.example" }), {
    baseUrl: "https://hermes.example", board: "beta",
  });
});
