import assert from "node:assert/strict";
import test from "node:test";

import { MAX_PROJECT_ID_LENGTH, PersistentSessionBroker, SessionBrokerClient } from "../src/session-broker.js";
import { resolveActiveProject } from "../src/muxy-tabs.js";

function dashboard() {
  return {
    baseUrl: "https://hermes.example",
    auth: {
      version: 1,
      providers: [{ name: "basic", displayName: "Password", supportsPassword: true }],
      identity: { userId: "user-1", email: "user@example.com", displayName: "Muxy User", organizationId: "org-1", provider: "basic", expiresAt: 4_102_444_800 },
      cookies: [["hermes_session_at", "access-one"], ["hermes_session_rt", "refresh-one"], ["hermes_session_provider", "basic"]],
    },
  };
}

function extensionStorage() {
  const values = new Map();
  return {
    get(key) { return values.get(key) ?? null; },
    set(key, value) { values.set(key, structuredClone(value)); },
    delete(key) { values.delete(key); },
  };
}

test("webviews persist only the global Dashboard session in extension-scoped storage", async () => {
  const storage = extensionStorage();
  let sequence = 0;
  const client = new SessionBrokerClient({ storage, randomId: () => `request-${++sequence}` });

  await client.saveDashboard(dashboard());
  const restoredDashboard = await client.readDashboard();

  assert.equal(restoredDashboard.auth.cookies[0][1], "access-one");
  assert.equal(Object.hasOwn(restoredDashboard, "board"), false);
  restoredDashboard.auth.cookies.push(["hermes_session_rt", "changed-by-panel"]);
  assert.equal((await client.readDashboard()).auth.cookies.length, 3, "the broker must not share mutable references");

  const restartedClient = new SessionBrokerClient({ storage, randomId: () => `restart-${++sequence}` });
  assert.equal((await restartedClient.readDashboard()).auth.identity.userId, "user-1", "the Dashboard sign-in must survive a Muxy restart");

  await restartedClient.clearDashboard();
  assert.equal(await restartedClient.readDashboard(), null);
});

test("legacy Gateway credentials cannot be saved or restored", async () => {
  const storage = extensionStorage();
  storage.set("session.gateway.v1", { url: "https://gateway.example", bearer: "old-token" });
  const broker = new PersistentSessionBroker({ storage });

  assert.equal((await broker.handle({ requestId: "one", action: "gateway.save", data: { bearer: "new-token" } })).ok, false);
  assert.equal((await broker.handle({ requestId: "two", action: "gateway.read" })).data, null);
  assert.equal(storage.get("session.gateway.v1"), null);
});

test("obsolete combined Dashboard records are deleted rather than restored or migrated", async () => {
  const storage = extensionStorage();
  storage.set("session.dashboard.v1", { ...dashboard(), board: "legacy" });
  const client = new SessionBrokerClient({ storage, randomId: () => "picker" });
  assert.equal(await client.readDashboard(), null);
  assert.equal(storage.get("session.dashboard.v1"), null);
});

test("project board mappings are isolated by stable project ID and exact Dashboard URL", async () => {
  const storage = extensionStorage();
  let sequence = 0;
  const client = new SessionBrokerClient({ storage, randomId: () => `mapping-${++sequence}` });

  assert.equal(await client.saveBoardMapping({ projectID: "project-a", baseUrl: "https://hermes.example", board: "Alpha" }), true);
  assert.equal(await client.saveBoardMapping({ projectID: "project-b", baseUrl: "https://hermes.example", board: "beta" }), true);
  const a = await client.readBoardMapping({ projectID: "project-a", baseUrl: "https://hermes.example" });
  assert.deepEqual(a, { baseUrl: "https://hermes.example", board: "alpha" });
  a.board = "mutated";
  assert.deepEqual(await client.readBoardMapping({ projectID: "project-a", baseUrl: "https://hermes.example" }), { baseUrl: "https://hermes.example", board: "alpha" });
  assert.deepEqual(await client.readBoardMapping({ projectID: "project-b", baseUrl: "https://hermes.example" }), { baseUrl: "https://hermes.example", board: "beta" });
  assert.equal(await client.readBoardMapping({ projectID: "project-a", baseUrl: "https://other.example" }), null);
  assert.deepEqual(await client.readBoardMapping({ projectID: "project-a", baseUrl: "https://hermes.example" }), { baseUrl: "https://hermes.example", board: "alpha" });

  assert.equal(await client.clearBoardMapping({ projectID: "project-a" }), true);
  assert.equal(await client.readBoardMapping({ projectID: "project-a", baseUrl: "https://hermes.example" }), null);
  assert.deepEqual(await client.readBoardMapping({ projectID: "project-b", baseUrl: "https://hermes.example" }), { baseUrl: "https://hermes.example", board: "beta" });
  assert.equal(await client.saveBoardMapping({ projectID: "", baseUrl: "https://hermes.example", board: "alpha" }), false);
  assert.equal(await client.saveBoardMapping({ projectID: "project-a", baseUrl: "ftp://hermes.example", board: "alpha" }), false);
  assert.equal(await client.saveBoardMapping({ projectID: "project-a", baseUrl: "https://hermes.example", board: "not a slug" }), false);
});

test("active-project resolution accepts only one valid stable active identity", async () => {
  const muxy = { projects: { async list() { return [
    { id: "project-a", name: "Renamed project", isActive: true, path: "/not-an-identity" },
    { id: "project-b", name: "Other project", isActive: false },
  ]; } } };
  assert.deepEqual(await resolveActiveProject(muxy), { id: "project-a", name: "Renamed project" });
  await assert.rejects(() => resolveActiveProject({ projects: { async list() { return []; } } }), /active project/i);
  await assert.rejects(() => resolveActiveProject({ projects: { async list() { return [{ id: "a", name: "A", isActive: true }, { id: "b", name: "B", isActive: true }]; } } }), /active project/i);
  await assert.rejects(() => resolveActiveProject({ projects: { async list() { return [{ id: "", name: "A", isActive: true }]; } } }), /identity/i);
  await assert.rejects(() => resolveActiveProject(null), /project bridge/i);
});

test("project IDs cannot produce mapping keys beyond Muxy's storage limit", async () => {
  const storage = extensionStorage();
  const client = new SessionBrokerClient({ storage, randomId: () => "project-id-boundary" });
  const maximumProjectID = `p${"a".repeat(MAX_PROJECT_ID_LENGTH - 1)}`;
  const oversizedProjectID = `${maximumProjectID}a`;

  assert.equal(MAX_PROJECT_ID_LENGTH, 239);
  assert.equal(await client.saveBoardMapping({ projectID: maximumProjectID, baseUrl: "https://hermes.example", board: "alpha" }), true);
  assert.equal(await client.saveBoardMapping({ projectID: oversizedProjectID, baseUrl: "https://hermes.example", board: "alpha" }), false);
  assert.deepEqual(await resolveActiveProject({ projects: { async list() { return [{ id: maximumProjectID, name: "Boundary", isActive: true }]; } } }), { id: maximumProjectID, name: "Boundary" });
  await assert.rejects(
    () => resolveActiveProject({ projects: { async list() { return [{ id: oversizedProjectID, name: "Too long", isActive: true }]; } } }),
    /identity/i,
  );
});
