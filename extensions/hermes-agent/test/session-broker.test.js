import assert from "node:assert/strict";
import test from "node:test";

import { PersistentSessionBroker, SessionBrokerClient } from "../src/session-broker.js";

function dashboard() {
  return {
    baseUrl: "https://hermes.example",
    board: "default",
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

test("webviews persist only the Dashboard session in extension-scoped storage", async () => {
  const storage = extensionStorage();
  let sequence = 0;
  const client = new SessionBrokerClient({ storage, randomId: () => `request-${++sequence}` });

  await client.saveDashboard(dashboard());
  const restoredDashboard = await client.readDashboard();

  assert.equal(restoredDashboard.auth.cookies[0][1], "access-one");
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

test("Dashboard sessions may be restored before a board is chosen", async () => {
  const storage = extensionStorage();
  const client = new SessionBrokerClient({ storage, randomId: () => "picker" });
  await client.saveDashboard({ ...dashboard(), board: null });
  assert.equal((await client.readDashboard()).board, null);

  await client.saveDashboard({ ...dashboard(), board: "Chosen_Board" });
  assert.equal((await client.readDashboard()).board, "chosen_board");
});
