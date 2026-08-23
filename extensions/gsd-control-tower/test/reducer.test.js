import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialState, applyInventory, applyAgentEvent, applyAgentHydration,
  applyFileChanged, applyHeadChanged, applyWorkstreamData, pushDiagnostic,
  wsKey, isPlanningPath,
} from "../src/core/reducer.js";
import { BOUNDS } from "../src/core/types.js";

function inventory() {
  let state = initialState();
  const projects = [
    { id: "p1", name: "alpha", path: "/tmp/alpha", isActive: true },
    { id: "p2", name: "beta", path: "/tmp/beta", isActive: false },
  ];
  const trees = new Map([
    ["p1", [{ id: "w1", name: "main", path: "/tmp/alpha", isPrimary: true }, { id: "w2", name: "feature", path: "/tmp/alpha-feature" }]],
    ["p2", [{ id: null, name: "root", path: "/tmp/beta" }]],
  ]);
  state = applyInventory(state, projects, trees);
  return state;
}

test("applyInventory creates one workstream per worktree plus project roots", () => {
  const state = inventory();
  assert.deepEqual([...state.workstreams.keys()].sort(), ["p1::w1", "p1::w2", "p2::root"]);
});

test("inventory replacement prunes deleted projects and recreated worktrees", () => {
  let state = inventory();
  state = applyWorkstreamData(state, "p1::w1", { isGsd: true, at: "2026-08-23T12:00:00Z" });
  state = applyInventory(
    state,
    [{ id: "p1", name: "alpha", path: "/tmp/alpha", isActive: true }],
    new Map([["p1", [{ id: "w3", name: "recreated", path: "/tmp/alpha" }]]]),
    "2026-08-23T12:01:00Z",
  );
  assert.deepEqual([...state.workstreams.keys()], ["p1::w3"]);
  assert.equal(state.workstreams.has("p2::root"), false);
  assert.equal(state.workstreams.has("p1::w1"), false);
});

test("agent.status updates only the owning workstream (FR-021)", () => {
  let state = inventory();
  state = applyAgentEvent(state, { worktreeID: "w1", projectID: "p1", providerID: "claude", status: "waiting" });
  assert.equal(state.workstreams.get("p1::w1").agent.runtimeState, "waiting");
  assert.equal(state.workstreams.get("p1::w1").agent.providerId, "claude");
  assert.equal(state.workstreams.get("p1::w2").agent.runtimeState, "unavailable");
});

test("agent events for unknown worktrees park as orphans and reattach on inventory", () => {
  let state = initialState();
  state = applyAgentEvent(state, { worktreeID: "wx", providerID: "droid", status: "working" });
  assert.equal(state.orphanAgents.get("wx")?.runtimeState, "working");

  state = applyInventory(state, [{ id: "p9", name: "late", path: "/tmp/late" }], new Map([["p9", [{ id: "wx", name: "main", path: "/tmp/late" }]]]));
  assert.equal(state.workstreams.get("p9::wx").agent.runtimeState, "working");
  assert.equal(state.orphanAgents.size, 0);
});

test("orphan agent events expire and remain bounded", () => {
  let state = initialState();
  const start = Date.parse("2026-08-23T12:00:00Z");
  for (let i = 0; i < BOUNDS.maxOrphanAgents + 25; i++) {
    state = applyAgentEvent(
      state,
      { worktreeID: `orphan-${i}`, status: "waiting" },
      new Date(start + i).toISOString(),
    );
  }
  assert.equal(state.orphanAgents.size, BOUNDS.maxOrphanAgents);
  assert.equal(state.orphanAgents.has("orphan-0"), false);

  state = applyInventory(state, [], new Map(), new Date(start + BOUNDS.orphanAgentTtlMs + 10_000).toISOString());
  assert.equal(state.orphanAgents.size, 0);
});

test("agents.list() hydration tolerates wrapper objects and unknown fields (NFR-031)", () => {
  let state = inventory();
  state = applyAgentHydration(state, {
    agents: [
      { worktreeID: "w2", projectID: "p1", providerID: "codex", status: "working", futureField: { x: 1 } },
      { worktreeId: "w1", projectId: "p1", providerId: "pi", status: "idle" }, // alt casing
      null,
      "junk",
    ],
  });
  assert.equal(state.workstreams.get("p1::w2").agent.runtimeState, "working");
  assert.equal(state.workstreams.get("p1::w1").agent.runtimeState, "idle");
});

test("file.changed marks active worktree live only for planning paths (FR-030/031)", () => {
  let state = inventory();
  state = applyWorkstreamData(state, "p1::w1", { isActiveWorktree: true, at: new Date().toISOString() });
  state = applyFileChanged(state, { path: ".planning/STATE.md", projectPath: "/tmp/alpha" });
  assert.equal(state.workstreams.get("p1::w1").freshness, "live");
  // Inactive siblings keep their previous freshness.
  assert.equal(state.workstreams.get("p1::w2").freshness, "stale");

  const before = state;
  state = applyFileChanged(state, { path: "src/app.js", projectPath: "/tmp/alpha" });
  assert.equal(state, before, "non-planning paths must not touch the store");
});

test("isPlanningPath matches directory and nested paths", () => {
  assert.equal(isPlanningPath(".planning"), true);
  assert.equal(isPlanningPath(".planning/phases/01-x/01-01-PLAN.md"), true);
  assert.equal(isPlanningPath(".planning"), true);
  assert.equal(isPlanningPath("src/.planning-thing.js"), false);
  assert.equal(isPlanningPath(""), false);
});

test("worktree.headChanged updates branch context only for the target (FR-033)", () => {
  let state = inventory();
  state = applyWorkstreamData(state, "p1::w1", { git: { branch: "main" }, at: new Date().toISOString() });
  state = applyHeadChanged(state, { projectID: "p1", worktreeID: "w1", branch: "feat/tower" });
  assert.equal(state.workstreams.get("p1::w1").git.branch, "feat/tower");
  assert.equal(state.workstreams.get("p1::w2").git, undefined);
});

test("diagnostics stay bounded at BOUNDS.maxDiagnostics (NFR-004)", () => {
  let state = initialState();
  for (let i = 0; i < BOUNDS.maxDiagnostics + 25; i++) {
    state = pushDiagnostic(state, { at: new Date().toISOString(), message: `err ${i}` });
  }
  assert.equal(state.diagnostics.errors.length, BOUNDS.maxDiagnostics);
  assert.match(state.diagnostics.errors.at(-1).message, /err 7[44]/);
});

test("wsKey is stable and explicit about root worktrees", () => {
  assert.equal(wsKey("p1", "w1"), "p1::w1");
  assert.equal(wsKey("p1", null), "p1::root");
});
