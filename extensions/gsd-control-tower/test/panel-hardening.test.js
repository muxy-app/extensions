import { test } from "node:test";
import assert from "node:assert/strict";
import { ControlTowerApp } from "../src/panel/app.js";
import { initialState } from "../src/core/reducer.js";

function bareApp() {
  const app = new ControlTowerApp(null);
  app.render = () => {};
  app.publishCounts = () => {};
  app.maybeAutoFocusActiveProject = () => {};
  return app;
}

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

test("extension.snapshot promise rejections become bounded diagnostics", async () => {
  const app = bareApp();
  app.state = initialState();
  app.currentRows = () => [];
  app.updateStatusBar = () => {};
  const previous = globalThis.muxy;
  globalThis.muxy = { events: { emit: () => Promise.reject(new Error("background unavailable")) } };
  try {
    ControlTowerApp.prototype.publishCounts.call(app);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(app.state.diagnostics.errors.length, 1);
    assert.match(app.state.diagnostics.errors[0].message, /extension\.snapshot: background unavailable/);
  } finally {
    globalThis.muxy = previous;
  }
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
    assert.match(row.inventoryWarning, /Worktree inventory unavailable/);
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
