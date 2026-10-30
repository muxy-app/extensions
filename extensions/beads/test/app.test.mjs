import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const bundle = await build({
  configFile: false,
  logLevel: "silent",
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  build: { ssr: fileURLToPath(new URL("../src/panel/app.js", import.meta.url)), write: false },
});
const { BeadsBoardPanel } = await import(`data:text/javascript;base64,${Buffer.from(bundle.output[0].code).toString("base64")}`);

const issue = { id: "demo-1", title: "First", status: "open", priority: 1 };
const ok = (value) => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: "" });
const idle = { exitCode: 0, stdout: "", stderr: "" };

function setup(t, responses = []) {
  const originalMuxy = globalThis.muxy;
  const originalWindow = globalThis.window;
  const calls = [];
  const writes = [];
  const listeners = new Map();
  globalThis.muxy = {
    exec: async (argv) => {
      calls.push(argv);
      const response = responses.shift();
      return typeof response === "function" ? response() : response;
    },
    files: { read: async () => ({ content: '{"name":"Demo"}' }) },
    projects: { list: async () => [{ id: "project", path: "/work/demo", isActive: true }] },
    worktrees: { list: async () => [{ id: "worktree", path: "/work/demo", isActive: true }] },
    storage: { get: async () => null, set: async (key, value) => { writes.push({ key, value }); } },
    topbar: { set: () => {} },
    events: { subscribe: (name, handler) => { listeners.set(name, handler); } },
  };
  globalThis.window = { muxy: globalThis.muxy };
  const panel = new BeadsBoardPanel({ classList: { add: () => {} } });
  let renders = 0;
  panel.render = () => { renders += 1; };
  panel.renderContent = () => {};
  t.after(() => {
    panel.destroy();
    globalThis.muxy = originalMuxy;
    globalThis.window = originalWindow;
  });
  return { panel, calls, writes, listeners, renders: () => renders };
}

test("idle polls do not redraw or rewrite the cache, but manual refresh always does", async (t) => {
  const { panel, calls, writes, renders } = setup(t, [idle, ok([issue]), ok([issue]), idle, idle, ok([issue]), ok([])]);
  await panel.refresh();
  panel.selectedIssue = panel.issues[0];
  const selected = panel.selectedIssue;
  assert.equal(renders(), 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value.journalSeq, undefined);

  await panel.refresh(panel.refreshGeneration, false);
  assert.equal(calls.length, 4);
  assert.equal(renders(), 1);
  assert.equal(writes.length, 1);
  assert.equal(panel.selectedIssue, selected);
  assert.equal(panel.refreshing, false);

  await panel.refresh();
  assert.equal(calls.length, 7);
  assert.equal(renders(), 2);
  assert.equal(writes.length, 2);
  assert.equal(panel.selectedIssue.ready, false);
});

test("workspace switches clear the checkpoint and block polling during the debounce", async (t) => {
  const { panel, calls } = setup(t, [idle, ok([issue]), ok([])]);
  await panel.refresh();
  assert.equal(panel.boardData.journalSeq, 0);
  panel.delayedRefresh();
  assert.equal(panel.boardData, null);
  assert.deepEqual(panel.issues, []);
  await panel.refresh(panel.refreshGeneration, false);
  assert.equal(calls.length, 3);
});

test("an in-flight refresh cannot install a checkpoint after a workspace switch", async (t) => {
  let release;
  let started;
  const pending = new Promise((resolve) => { release = resolve; });
  const reading = new Promise((resolve) => { started = resolve; });
  const { panel } = setup(t, [() => { started(); return pending; }, ok([issue]), ok([])]);
  const refresh = panel.refresh();
  await reading;
  panel.delayedRefresh();
  release({ ...idle, stdout: JSON.stringify({ seq: 30, op: "update", issue_id: issue.id, issue }) });
  await refresh;
  assert.equal(panel.boardData, null);
  assert.deepEqual(panel.issues, []);
});

test("an idle recovery clears a visible cached-data error", async (t) => {
  const { panel, renders } = setup(t, [idle, ok([issue]), ok([]), idle]);
  await panel.refresh();
  panel.error = "Temporary failure";
  panel.usingCache = true;
  await panel.refresh(panel.refreshGeneration, false);
  assert.equal(panel.error, null);
  assert.equal(panel.usingCache, false);
  assert.equal(renders(), 2);
});

test("auto-refresh uses the journal path, and Never removes the timer", (t) => {
  const { panel } = setup(t);
  t.mock.timers.enable({ apis: ["setInterval"] });
  const calls = [];
  panel.refresh = (...args) => { calls.push(args); };
  panel.applyAutoRefreshTimer();
  t.mock.timers.tick(15000);
  assert.deepEqual(calls, [[panel.refreshGeneration, false]]);
  panel.autoRefreshMs = 0;
  panel.applyAutoRefreshTimer();
  t.mock.timers.tick(300000);
  assert.equal(calls.length, 1);
});

test("branch changes invalidate the journal just like workspace switches", async (t) => {
  const { panel, listeners } = setup(t);
  panel.refresh = () => {};
  panel.applyAutoRefreshTimer = () => {};
  await panel.start();
  panel.boardData = { journalSeq: 42 };
  listeners.get("worktree.headChanged")();
  assert.equal(panel.boardData, null);
});
