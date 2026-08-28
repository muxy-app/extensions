import { test } from "node:test";
import assert from "node:assert/strict";
import { ControlTowerApp, countLabel, phaseStatusOf } from "../src/panel/app.js";
import { initialState } from "../src/core/reducer.js";

function bareApp() {
  const app = new ControlTowerApp(null);
  app.render = () => {};
  app.maybeAutoFocusActiveProject = () => {};
  return app;
}

test("header counts use singular and plural labels", () => {
  assert.equal(countLabel(1, "workstream"), "1 workstream");
  assert.equal(countLabel(0, "workstream"), "0 workstreams");
});

test("phase labels stay explicit when artifacts and STATE.md disagree", () => {
  const base = {
    dir: "03-two-route-mission-spine",
    done: false,
    pausedMarker: false,
    isCurrent: false,
    verification: "unknown",
  };

  assert.equal(phaseStatusOf(base).label, "Not current");
  assert.equal(phaseStatusOf({ ...base, dir: "" }).label, "Planned");
  assert.equal(phaseStatusOf({ ...base, isCurrent: true }).label, "Current");
  assert.equal(phaseStatusOf({ ...base, pausedMarker: true, isCurrent: true }).label, "Paused");
  assert.equal(phaseStatusOf({ ...base, done: true, isCurrent: true }).label, "Complete");
  assert.equal(phaseStatusOf({ ...base, verification: "failed", done: true }).label, "Verification failed");
});

test("agent activity disclosure defaults from activity and preserves user choice", () => {
  const app = bareApp();
  const row = { key: "p1::root", agent: { runtimeState: "unavailable" } };

  assert.equal(app.isAgentActivityExpanded(row), false);
  assert.equal(app.isAgentActivityExpanded({
    ...row,
    agent: { runtimeState: "working", providerId: "codex" },
  }), true);

  app.agentActivityExpanded.set(row.key, false);
  assert.equal(app.isAgentActivityExpanded({
    ...row,
    agent: { runtimeState: "working", providerId: "codex" },
  }), false);

  app.agentActivityExpanded.set(row.key, true);
  assert.equal(app.isAgentActivityExpanded(row), true);
});

test("refresh requests coalesce into one follow-up while a refresh is in flight", async () => {
  const app = bareApp();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  app.performFullRefresh = async () => {
    calls += 1;
    if (calls === 1) await gate;
    return true;
  };

  const first = app.fullRefresh();
  await Promise.resolve();
  await Promise.all([app.fullRefresh(), app.fullRefresh(), app.fullRefresh()]);
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(calls, 2);
  assert.equal(app.refreshing, false);
});

test("automatic cross-project refresh follows the user interval and never polls agents", () => {
  const app = bareApp();
  let refreshes = 0;
  app.fullRefresh = () => { refreshes += 1; };
  app.state.diagnostics.lastFullRefresh = "2026-08-24T00:54:00Z";
  app.prefs = { refreshIntervalMinutes: 5 };
  assert.equal(app.maybeAutoRefresh(Date.parse("2026-08-24T01:00:00Z")), true);
  assert.equal(refreshes, 1);

  app.prefs = { refreshIntervalMinutes: 0 };
  assert.equal(app.maybeAutoRefresh(Date.parse("2026-08-24T02:00:00Z")), false);
  assert.equal(refreshes, 1);

  app.prefs = { refreshIntervalMinutes: 5 };
  app.refreshing = true;
  assert.equal(app.maybeAutoRefresh(Date.parse("2026-08-24T02:00:00Z")), false);
  assert.equal(refreshes, 1);
});

test("worktree permission failures are explicit instead of silent empty inventory", async () => {
  const app = bareApp();
  app.state = initialState();
  const previous = globalThis.muxy;
  globalThis.muxy = {
    projects: { list: async () => [{ id: "p1", name: "sanitized-project", path: "/tmp/sanitized-project", isActive: true }] },
    worktrees: { list: async () => { throw new Error("permission denied (worktrees:read)"); } },
    files: {
      list: async () => { throw new Error("not found"); },
      read: async () => { throw new Error("not found"); },
    },
    git: {
      repoInfo: async () => ({ root: "/tmp/sanitized-project" }),
      status: async () => ({ branch: "main", stagedFiles: [], unstagedFiles: [] }),
      log: async () => [],
    },
    agents: { list: async () => [] },
  };
  try {
    assert.equal(await app.performFullRefresh(), true);
    const row = app.state.workstreams.get("p1::root");
    assert.equal(row.inventoryWarning, "Project details unavailable");
    assert.ok(app.state.diagnostics.errors.some((entry) => entry.context === "inventory"));
    assert.equal(app.state.diagnostics.permissionProbes["worktrees.list"], false);
  } finally {
    globalThis.muxy = previous;
  }
});

test("initial project focus follows Muxy's active project, not another project's active worktree", () => {
  const app = bareApp();
  app.loaded = true;
  app.prefs = { openOnActiveProject: true };
  app.state.projects = [
    { id: "p1", name: "first", isActive: false },
    { id: "p2", name: "current", isActive: true },
  ];
  app.currentRows = () => [
    { key: "p1::root", projectId: "p1", isActiveWorktree: true, isGsd: true, gsd: {} },
    { key: "p2::root", projectId: "p2", isActiveWorktree: true, isGsd: true, gsd: {} },
  ];
  ControlTowerApp.prototype.maybeAutoFocusActiveProject.call(app);
  assert.equal(app.selectedKey, "p2::root");
  assert.equal(app.view, "project");
});
