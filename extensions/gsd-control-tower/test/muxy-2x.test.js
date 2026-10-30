import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControlTowerApp } from "../src/panel/app.js";
import { applyInventory, applyFileChanged, applyWorkstreamData, initialState } from "../src/core/reducer.js";
import { createDemo } from "../scripts/create-demo.mjs";
import { fsSource } from "./helpers.js";
import { buildGsdSnapshot } from "../src/core/gsd/parse-planning.js";

function app() {
  const instance = new ControlTowerApp(null);
  instance.render = () => {};
  return instance;
}

test("Muxy 2 selectors isolate planning and Git for root and child worktrees", async () => {
  const instance = app();
  const previous = globalThis.muxy;
  const selected = [];
  globalThis.muxy = {
    projects: { list: async () => [{ id: "p1", name: "demo", path: "/tmp/demo", isActive: true }] },
    worktrees: { list: async () => [
      { id: "p1", path: "/tmp/demo", name: "main", isActive: false },
      { id: "w2", path: "/tmp/demo-sync", name: "offline-sync", isActive: true },
    ] },
    files: {
      list: async (_, { project }) => { selected.push(project); return [{ name: "STATE.md", isDirectory: false }]; },
      read: async (path, { project }) => path === ".planning/STATE.md"
        ? { content: `---\ngsd_state_version: 1.0\nmilestone: ${project === "p1" ? "v1.0" : "v2.0"}\n---\n` } : null,
    },
    git: {
      repoInfo: async () => ({ root: "/tmp/demo" }),
      status: async ({ project }) => ({ branch: project === "p1" ? "main" : "feature/sync", stagedFiles: [{ path: "note.md" }], unstagedFiles: [{ path: "note.md" }] }),
      log: async ({ project }) => [{ subject: project, authorDate: "2026-10-18T12:00:00Z" }],
    },
    agents: { list: async () => [{ projectID: "p1", worktreeID: "p1", status: "working", providerID: "codex" }] },
  };
  try {
    assert.equal(await instance.performFullRefresh(), true);
    const root = instance.state.workstreams.get("p1::p1");
    const child = instance.state.workstreams.get("p1::w2");
    assert.equal(root.gsd.milestone, "v1.0");
    assert.equal(child.gsd.milestone, "v2.0");
    assert.equal(root.git.branch, "main");
    assert.equal(child.git.branch, "feature/sync");
    assert.equal(root.git.dirtyCount, 1);
    assert.equal(root.git.lastCommitSubject, "p1");
    assert.equal(child.git.lastCommitSubject, "w2");
    assert.equal(child.isActiveWorktree, true);
    assert.equal(root.agent.runtimeState, "working");
    assert.ok(selected.includes("p1") && selected.includes("w2"));
    assert.equal(instance.findProjectByPath("/tmp/demo-sync/").id, "p1");
    // A parent selector may follow the selected child in Muxy 2.1.
    globalThis.muxy.git.repoInfo = async () => ({ root: "/tmp/demo-sync" });
    await instance.refreshProject(instance.state.projects[0]);
    const unavailable = instance.state.workstreams.get("p1::p1");
    assert.equal(unavailable.gsd, null);
    assert.equal(unavailable.dataUnavailable, true);
    assert.equal(unavailable.git.lastCommitSubject, undefined);
    assert.match(unavailable.gsdUnavailableReason, /select it in Muxy/);
    assert.equal(instance.state.workstreams.get("p1::w2").gsd.milestone, "v2.0");
    globalThis.muxy.git.repoInfo = async () => ({ root: "/tmp/demo" });
    // A planning directory removed since the last refresh must clear the snapshot.
    globalThis.muxy.files.list = async () => { throw new Error("not found"); };
    await instance.refreshProject(instance.state.projects[0]);
    assert.equal(instance.state.workstreams.get("p1::w2").gsd, null);
    assert.equal(instance.state.workstreams.get("p1::w2").isGsd, false);
  } finally { globalThis.muxy = previous; }
});

test("file events from a child worktree do not mark its parent or sibling changed", () => {
  let state = applyInventory(initialState(), [{ id: "p", path: "/tmp/demo" }], new Map([["p", [
    { id: "p", path: "/tmp/demo" }, { id: "w", path: "/tmp/demo-sync" },
  ]]]));
  state = applyWorkstreamData(state, "p::w", { isActiveWorktree: true });
  const next = applyFileChanged(state, { path: ".planning/STATE.md", projectPath: "/tmp/demo-sync" });
  assert.equal(next.workstreams.get("p::w").freshness, "live");
  assert.equal(next.workstreams.get("p::p").lastEventAt, undefined);
});

test("demo creates three independent realistic worktree scenarios without overwriting", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "control-tower-demo-test-"));
  const destination = join(temporary, "demo");
  try {
    const { main, worktrees } = await createDemo(destination);
    const snapshots = await Promise.all([main, ...worktrees].map(async (root) => (await buildGsdSnapshot(fsSource(root))).gsd));
    assert.equal(snapshots[0].paused, false);
    assert.equal(snapshots[1].paused, true);
    assert.equal(snapshots[2].verification, "failed");
    assert.ok(snapshots[0].phases.some((phase) => phase.isCurrent && phase.plansTotal === 2));
    assert.ok(snapshots[2].nextAction);
    await assert.rejects(createDemo(destination), { code: "EEXIST" });
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("native absolute file events and watcher rescans schedule planning refreshes", () => {
  const instance = app();
  instance.state = applyInventory(initialState(), [{ id: "p", path: "/tmp/demo" }], new Map([["p", [
    { id: "w", path: "/tmp/demo-sync" },
  ]]]));
  const refreshed = [];
  instance.debounce = (_, fn) => fn();
  instance.refreshProject = (project) => refreshed.push(project.id);
  instance.scheduleTargetedReparse({ path: "/tmp/demo-sync/.planning/STATE.md", projectPath: "/tmp/demo-sync" });
  instance.scheduleTargetedReparse({ path: "/tmp/demo-sync", projectPath: "/tmp/demo-sync" });
  instance.scheduleTargetedReparse({ path: "/tmp/demo-sync/src/notes.js", projectPath: "/tmp/demo-sync" });
  assert.deepEqual(refreshed, ["p", "p"]);
});

test("unreadable planning inventory remains an error instead of becoming non-GSD", async () => {
  const result = await buildGsdSnapshot({ list: async () => { throw new Error("server disconnected"); } });
  assert.equal(result.recognized, false);
  assert.match(result.gsd.errors[0], /server disconnected/);
});
