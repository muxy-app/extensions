import assert from "node:assert/strict";
import test from "node:test";

import { DashboardAuthError } from "../src/dashboard-auth.js";
import { buildDashboardWebSocketUrl, DashboardGatewayClient, DashboardGatewayError } from "../src/dashboard-gateway.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ listener, once: options?.once === true });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry.listener !== listener));
  }

  dispatch(type, event) {
    const listeners = [...(this.listeners.get(type) ?? [])];
    for (const entry of listeners) {
      entry.listener(event);
      if (entry.once) this.removeEventListener(type, entry.listener);
    }
    this[`on${type}`]?.(event);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open", {});
  }

  send(raw) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("closed");
    this.sent.push(JSON.parse(raw));
  }

  receive(message) {
    this.dispatch("message", { data: JSON.stringify(message) });
  }

  close(code = 1000) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", { code });
  }
}

function authSession({ tickets = ["ticket_abcdefghijklmnopqrstuvwxyz0123456789"], failAt = null } = {}) {
  let calls = 0;
  return {
    baseUrl: "http://127.0.0.1:9119",
    exportSession() { return { version: 1, cookies: [["hermes_session_at", "secret"]] }; },
    async requestWebSocketTicket() {
      calls += 1;
      if (calls === failAt) throw new DashboardAuthError("session_expired", 401);
      const ticket = tickets[Math.min(calls - 1, tickets.length - 1)];
      return { ticket, ttlSeconds: 30 };
    },
    get calls() { return calls; },
  };
}

async function openConnection(client) {
  const connecting = client.connect();
  await tick();
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  await connecting;
  return socket;
}

test.beforeEach(() => { FakeWebSocket.instances = []; });

test("WebSocket URLs use the Dashboard origin and a single ticket query parameter", () => {
  const ticket = "ticket_abcdefghijklmnopqrstuvwxyz0123456789";
  assert.equal(
    buildDashboardWebSocketUrl("http://127.0.0.1:9119", ticket),
    `ws://127.0.0.1:9119/api/ws?ticket=${ticket}`,
  );
  assert.equal(
    buildDashboardWebSocketUrl("https://hermes.example", ticket),
    `wss://hermes.example/api/ws?ticket=${ticket}`,
  );
  assert.throws(() => buildDashboardWebSocketUrl("https://hermes.example", "bad"), DashboardGatewayError);
});

test("connect coalesces concurrent work, persists rotated session data, and exposes no ticket in state", async () => {
  const auth = authSession();
  const persisted = [];
  const client = new DashboardGatewayClient({
    authSession: auth,
    WebSocketImpl: FakeWebSocket,
    persistSession: async (session) => persisted.push(session),
    reconnectDelays: [0],
  });
  const states = [];
  client.subscribe((snapshot) => states.push(snapshot));

  const first = client.connect();
  const second = client.connect();
  await tick();
  assert.equal(auth.calls, 1);
  assert.equal(FakeWebSocket.instances.length, 1);
  FakeWebSocket.instances[0].open();
  await Promise.all([first, second]);

  assert.equal(client.snapshot.state, "connected");
  assert.equal(persisted.length, 1);
  assert.equal(JSON.stringify(states).includes("ticket_"), false);
});

test("a failing state subscriber cannot tear down a healthy connection", async () => {
  const client = new DashboardGatewayClient({ authSession: authSession(), WebSocketImpl: FakeWebSocket });
  client.subscribe((snapshot) => {
    if (snapshot.state === "connected") throw new Error("render failed");
  });

  const socket = await openConnection(client);

  assert.equal(client.snapshot.state, "connected");
  assert.equal(socket.readyState, FakeWebSocket.OPEN);
});

test("every reconnect mints a fresh ticket and reattaches the active live session", async () => {
  const auth = authSession({ tickets: [
    "ticket_abcdefghijklmnopqrstuvwxyz0123456789",
    "ticket_ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210",
  ] });
  const client = new DashboardGatewayClient({ authSession: auth, WebSocketImpl: FakeWebSocket, reconnectDelays: [0] });
  const first = await openConnection(client);
  client.setActiveSession({ runtimeId: "runtime-1", storedId: "stored-1" });

  first.close(1006);
  await tick();
  await tick();
  const second = FakeWebSocket.instances.at(-1);
  assert.notEqual(second, first);
  assert.match(first.url, /abcdefghijklmnopqrstuvwxyz/);
  assert.match(second.url, /ZYXWVUT/);
  second.open();
  await tick();
  assert.deepEqual(second.sent[0], {
    jsonrpc: "2.0", id: "m1", method: "session.activate", params: { session_id: "runtime-1" },
  });
  second.receive({ jsonrpc: "2.0", id: "m1", result: { session_id: "runtime-1", session_key: "stored-1", running: true, status: "streaming" } });
  await tick();

  assert.equal(client.snapshot.state, "connected");
  assert.equal(auth.calls, 2);
  assert.deepEqual(client.getActiveSession(), { runtimeId: "runtime-1", storedId: "stored-1" });
});

test("reattach falls back from a missing runtime session to the stored session", async () => {
  const auth = authSession({ tickets: [
    "ticket_abcdefghijklmnopqrstuvwxyz0123456789",
    "ticket_ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210",
  ] });
  const client = new DashboardGatewayClient({ authSession: auth, WebSocketImpl: FakeWebSocket, reconnectDelays: [0] });
  const first = await openConnection(client);
  client.setActiveSession({ runtimeId: "runtime-old", storedId: "stored-1" });
  first.close(1006);
  await tick();
  await tick();
  const second = FakeWebSocket.instances.at(-1);
  second.open();
  await tick();
  second.receive({ jsonrpc: "2.0", id: "m1", error: { code: 4001, message: "session not found" } });
  await tick();
  assert.equal(second.sent[1].method, "session.resume");
  second.receive({ jsonrpc: "2.0", id: "m2", result: { session_id: "runtime-new", resumed: "stored-1", running: false, status: "idle" } });
  await tick();

  assert.equal(client.snapshot.state, "connected");
  assert.deepEqual(client.getActiveSession(), { runtimeId: "runtime-new", storedId: "stored-1" });
});

test("RPC requests are correlated and event envelopes are delivered without retaining raw frames", async () => {
  const client = new DashboardGatewayClient({ authSession: authSession(), WebSocketImpl: FakeWebSocket, reconnectDelays: [0] });
  const socket = await openConnection(client);
  const events = [];
  client.onEvent((event) => events.push(event));
  const pending = client.request("session.status", { session_id: "runtime-1" });
  assert.equal(socket.sent[0].method, "session.status");
  socket.receive({ jsonrpc: "2.0", id: socket.sent[0].id, result: { status: "idle" } });
  assert.deepEqual(await pending, { status: "idle" });
  socket.receive({ jsonrpc: "2.0", method: "event", params: { type: "message.delta", session_id: "runtime-1", payload: { text: "hello" } } });
  assert.deepEqual(events, [{ type: "message.delta", sessionId: "runtime-1", payload: { text: "hello" } }]);
  await assert.rejects(client.request("unsafe.method", {}), (error) => error.code === "rpc_method_not_allowed");
});

test("prompt submission uses the Gateway's long-running acknowledgement window", async () => {
  const scheduled = [];
  const client = new DashboardGatewayClient({
    authSession: authSession(),
    WebSocketImpl: FakeWebSocket,
    requestTimeoutMs: 120_000,
    promptTimeoutMs: 30 * 60 * 1000,
    setTimer(callback, delay) { scheduled.push({ callback, delay }); return scheduled.length; },
    clearTimer() {},
  });
  const connecting = client.connect();
  await tick();
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  await connecting;

  void client.request("prompt.submit", { session_id: "runtime-1", text: "hello" });

  assert.equal(scheduled.at(-1).delay, 30 * 60 * 1000);
});

test("network failures retry automatically, while primary-session rejection ends in signed out", async () => {
  const auth = authSession({
    tickets: ["ticket_abcdefghijklmnopqrstuvwxyz0123456789"],
    failAt: 2,
  });
  const client = new DashboardGatewayClient({ authSession: auth, WebSocketImpl: FakeWebSocket, reconnectDelays: [0] });
  const first = await openConnection(client);
  first.close(1006);
  await tick();
  await tick();

  assert.equal(auth.calls, 2);
  assert.equal(client.snapshot.state, "signed_out");
  assert.equal(FakeWebSocket.instances.length, 1, "an auth rejection must not loop on new sockets");
});

test("a stalled WebSocket upgrade becomes offline and schedules a transparent retry", async () => {
  const timers = new Map();
  let timerId = 0;
  const client = new DashboardGatewayClient({
    authSession: authSession(),
    WebSocketImpl: FakeWebSocket,
    reconnectDelays: [500],
    connectTimeoutMs: 10,
    setTimer(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimer(id) { timers.delete(id); },
  });

  const pending = client.connect();
  await tick();
  assert.equal(FakeWebSocket.instances.length, 1);
  timers.get(1)();
  await assert.rejects(pending, (error) => error.code === "connection_timeout");
  assert.equal(client.snapshot.state, "offline");
  assert.equal(client.snapshot.retryInMs, 500);
  assert.equal(client.snapshot.reason, "connection_timeout");
});
