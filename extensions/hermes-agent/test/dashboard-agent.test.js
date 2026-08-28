import assert from "node:assert/strict";
import test from "node:test";

import { DashboardAgentController } from "../src/dashboard-agent.js";

function gatewayFixture() {
  const stateListeners = new Set();
  const eventListeners = new Set();
  const calls = [];
  const gateway = {
    snapshot: { state: "connected" },
    active: null,
    calls,
    subscribe(listener) { stateListeners.add(listener); listener(this.snapshot); return () => stateListeners.delete(listener); },
    onEvent(listener) { eventListeners.add(listener); return () => eventListeners.delete(listener); },
    emit(event) { for (const listener of eventListeners) listener(event); },
    transition(state) { this.snapshot = { state }; for (const listener of stateListeners) listener(this.snapshot); },
    setActiveSession(session) { this.active = session; },
    getActiveSession() { return this.active; },
    async request(method, params) {
      calls.push({ method, params });
      if (method === "session.create") return { session_id: "runtime-1", stored_session_id: "stored-1" };
      return { status: "accepted" };
    },
  };
  return gateway;
}

test("agent controller creates a Hermes session, submits a prompt, and projects bounded live activity", async () => {
  const gateway = gatewayFixture();
  const agent = new DashboardAgentController({ gateway });
  await agent.start("Check this project");
  assert.deepEqual(gateway.calls.slice(0, 2), [
    { method: "session.create", params: { close_on_disconnect: false } },
    { method: "prompt.submit", params: { session_id: "runtime-1", text: "Check this project" } },
  ]);
  assert.deepEqual(gateway.active, { runtimeId: "runtime-1", storedId: "stored-1" });

  gateway.emit({ type: "message.delta", sessionId: "runtime-1", payload: { text: "Working " } });
  gateway.emit({ type: "tool.start", sessionId: "runtime-1", payload: { name: "terminal", args: { secret: "must-not-render" } } });
  gateway.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "Working done" } });

  assert.equal(agent.snapshot.status, "completed");
  assert.equal(agent.snapshot.assistant, "Working ");
  assert.deepEqual(agent.snapshot.activity, [{ kind: "tool", label: "terminal", detail: "" }]);
  assert.equal(JSON.stringify(agent.snapshot).includes("must-not-render"), false);

  const secondGateway = gatewayFixture();
  const secondAgent = new DashboardAgentController({ gateway: secondGateway });
  await secondAgent.start("Return one response");
  secondGateway.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "Complete response" } });
  assert.equal(secondAgent.snapshot.assistant, "Complete response", "the terminal message must render even without deltas");
  assert.equal(secondAgent.snapshot.request, "Return one response");
  assert.equal(secondAgent.reset(), true);
  assert.equal(secondAgent.snapshot.status, "idle");
  assert.equal(secondAgent.snapshot.request, "");
  assert.equal(secondAgent.snapshot.assistant, "");
});

test("agent approvals, steering, and stop map to allowlisted Dashboard RPC methods", async () => {
  const gateway = gatewayFixture();
  const agent = new DashboardAgentController({ gateway });
  await agent.start("Run checks");
  assert.equal(agent.reset(), false, "an active run cannot be hidden");
  gateway.emit({
    type: "approval.request",
    sessionId: "runtime-1",
    payload: { tool_name: "terminal", command: "npm test", choices: ["once", "always", "deny", "unsafe"] },
  });
  assert.deepEqual(agent.snapshot.pendingApproval.choices, ["once", "always", "deny"]);
  await agent.approve("once");
  await agent.steer("Also run the build");
  assert.deepEqual(await agent.stop(), { status: "accepted" });

  assert.deepEqual(gateway.calls.slice(2), [
    { method: "approval.respond", params: { session_id: "runtime-1", choice: "once" } },
    { method: "session.steer", params: { session_id: "runtime-1", text: "Also run the build" } },
    { method: "session.interrupt", params: { session_id: "runtime-1" } },
  ]);
  assert.equal(agent.snapshot.activity.at(-1).label, "Guidance queued");

  gateway.emit({
    type: "approval.request",
    sessionId: "runtime-1",
    payload: { command: "write AGENTS.md", description: "Protected instruction", allow_session: false, allow_permanent: false },
  });
  assert.deepEqual(agent.snapshot.pendingApproval.choices, ["once", "deny"]);
  assert.equal(agent.snapshot.pendingApproval.tool, "Protected instruction");
});

test("agent content survives transparent connection recovery and a lost server session becomes a new-request state", async () => {
  const gateway = gatewayFixture();
  const agent = new DashboardAgentController({ gateway });
  await agent.start("Keep this visible");
  gateway.emit({ type: "message.delta", sessionId: "runtime-1", payload: { text: "Partial answer" } });
  gateway.transition("reconnecting");
  assert.equal(agent.snapshot.assistant, "Partial answer");
  assert.equal(agent.snapshot.connectionState, "reconnecting");

  gateway.emit({ type: "gateway.reattached", sessionId: "runtime-1", payload: { running: true, status: "streaming" } });
  assert.equal(agent.snapshot.status, "running");
  gateway.emit({ type: "gateway.session_lost", sessionId: "runtime-1", payload: {} });
  assert.equal(agent.snapshot.status, "idle");
  assert.match(agent.snapshot.error, /start a new request/i);
});
