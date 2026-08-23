import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRows, attentionRows, statusCounts, filterRows, knownProviders, topAttention,
} from "../src/core/selectors.js";
import { initialState, applyInventory, applyWorkstreamData, applyAgentHydration } from "../src/core/reducer.js";

function makeStore() {
  let state = initialState();
  const projects = [
    { id: "p-wait", name: "zeta-waiting", path: "/tmp/zeta", isActive: true },
    { id: "p-blocked", name: "alpha-blocked", path: "/tmp/alpha", isActive: false },
    { id: "p-idle", name: "mid-idle-complete", path: "/tmp/mid", isActive: false },
    { id: "p-nongsd", name: "plain-project", path: "/tmp/plain", isActive: false },
    { id: "p-hidden", name: "hidden-project", path: "/tmp/hidden", isActive: false },
  ];
  const trees = new Map([
    ["p-wait", [{ id: null, name: "root", path: "/tmp/zeta" }]],
    ["p-blocked", [{ id: null, name: "root", path: "/tmp/alpha" }]],
    ["p-idle", [{ id: null, name: "root", path: "/tmp/mid" }]],
    ["p-nongsd", [{ id: null, name: "root", path: "/tmp/plain" }]],
    ["p-hidden", [{ id: null, name: "root", path: "/tmp/hidden" }]],
  ]);
  state = applyInventory(state, projects, trees);

  const now = Date.now();
  state = applyWorkstreamData(state, "p-wait::root", {
    at: new Date(now).toISOString(),
    isGsd: true,
    gsd: { recognized: true, blockers: [], verification: "unknown", paused: false, progress: { percent: 40 }, frontmatterStatus: "active", lastActivity: new Date(now - 60_000).toISOString(), evidence: [], errors: [] },
  });
  state = applyAgentHydration(state, [
    { projectID: "p-wait", providerID: "claude", status: "waiting" }, // root worktree (worktreeID absent)
  ]);

  state = applyWorkstreamData(state, "p-blocked::root", {
    at: new Date(now).toISOString(),
    isGsd: true,
    gsd: { recognized: true, blockers: ["Owner gate failed"], verification: "passed", paused: false, progress: { percent: 90 }, frontmatterStatus: "active", lastActivity: new Date(now - 120_000).toISOString(), evidence: [], errors: [] },
  });

  state = applyWorkstreamData(state, "p-idle::root", {
    at: new Date(now).toISOString(),
    isGsd: true,
    gsd: { recognized: true, blockers: [], verification: "passed", paused: false, progress: { percent: 100 }, frontmatterStatus: "complete", lastActivity: new Date(now - 3 * 60_000).toISOString(), evidence: [], errors: [] },
  });

  state = applyWorkstreamData(state, "p-nongsd::root", { at: new Date(now).toISOString(), isGsd: false });
  state = applyWorkstreamData(state, "p-hidden::root", { at: new Date(now).toISOString(), isGsd: true });
  return state;
}

const PREFS = { staleThresholdMinutes: 45, showNonGsd: true, hiddenProjects: ["p-hidden"], filters: { query: "", statuses: [], providers: [] } };

test("ranking follows PRD priority and attention set", () => {
  const rows = buildRows(makeStore(), PREFS);
  const order = rows.map((r) => r.controlState);
  assert.equal(order[0], "waiting");
  assert.equal(order[1], "blocked");
  assert.ok(order.indexOf("idle") > order.indexOf("blocked"));
  const att = attentionRows(rows);
  assert.deepEqual(att.map((r) => r.projectName), ["zeta-waiting", "alpha-blocked"]);
});

test("hidden projects are excluded (FR-004)", () => {
  const rows = buildRows(makeStore(), PREFS);
  assert.ok(!rows.some((r) => r.projectId === "p-hidden"));
});

test("counts aggregate by control state", () => {
  const counts = statusCounts(buildRows(makeStore(), PREFS));
  assert.equal(counts.waiting, 1);
  assert.equal(counts.blocked, 1);
  assert.equal(counts.idle, 2);
});

test("filters: query across names/paths/reasons; statuses; providers (FR-042)", () => {
  const rows = buildRows(makeStore(), PREFS);
  assert.equal(filterRows(rows, { query: "zeta" }).length, 1);
  assert.equal(filterRows(rows, { query: "owner gate" }).length, 1);
  assert.deepEqual(filterRows(rows, { statuses: ["blocked"] }).map((r) => r.projectName), ["alpha-blocked"]);
  assert.equal(filterRows(rows, { providers: ["claude"] }).length, 1);
  assert.equal(filterRows(rows, { providers: ["codex"] }).length, 0);
});

test("knownProviders lists distinct providers", () => {
  assert.deepEqual(knownProviders(buildRows(makeStore(), PREFS)), ["claude"]);
});

test("topAttention returns the single highest-priority row", () => {
  const top = topAttention(buildRows(makeStore(), PREFS));
  assert.equal(top?.controlState, "waiting");
  assert.equal(top?.projectName, "zeta-waiting");
});
