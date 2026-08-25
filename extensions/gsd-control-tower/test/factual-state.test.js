import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRows, filterRows } from "../src/core/selectors.js";
import { initialState } from "../src/core/reducer.js";

function row(name, statusLine) {
  return {
    key: `${name}::root`, projectId: name, projectName: name,
    projectPath: `/tmp/${name}`, worktreePath: `/tmp/${name}`,
    isActiveWorktree: true, isGsd: true,
    gsd: {
      recognized: true, statusLine, frontmatterStatus: statusLine,
      verification: "unknown", paused: false, errors: [], warnings: [], evidence: [],
    },
    agent: { runtimeState: "idle" },
    refreshedAt: "2026-08-24T00:00:00Z", freshness: "refreshed",
  };
}

test("free-form GSD status words remain display-only", () => {
  const state = initialState();
  for (const status of ["Blocked", "Complete", "Executing", "urgent priority", "nonsense words"]) {
    state.workstreams.set(`${status}::root`, row(status, status));
  }
  const rows = buildRows(state, { hiddenProjects: [] });
  assert.equal(rows.some((item) => "controlState" in item || "signals" in item || "priority" in item), false);
  for (const status of ["Blocked", "Complete", "Executing", "urgent priority", "nonsense words"]) {
    assert.equal(filterRows(rows, { query: status }).length, 1);
  }
});

test("runtime and verification remain independent recorded fields", () => {
  const state = initialState();
  const item = row("alpha", "Executing");
  item.agent = { runtimeState: "waiting", providerId: "codex" };
  item.gsd.verification = "failed";
  state.workstreams.set(item.key, item);
  const [built] = buildRows(state, { hiddenProjects: [] });
  assert.equal(built.agent.runtimeState, "waiting");
  assert.equal(built.gsd.verification, "failed");
  assert.equal("controlState" in built, false);
});
