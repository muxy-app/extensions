import test from "node:test";
import assert from "node:assert/strict";

import { loadBoardData } from "../src/panel/data.js";

const context = { projectName: "Demo", workspacePath: "/work/demo", workspaceKey: "project:worktree" };
const issue = { id: "demo-1", title: "First", status: "open", priority: 1 };
const listCommand = ["bd", "list", "--json", "--all", "--limit", "0"];
const readyCommand = ["bd", "ready", "--json"];
const eventsCommand = (since) => ["bd", "events", "tail", "--since", String(since), "--json"];
const ok = (value) => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: "" });
const journal = (records = []) => ({ exitCode: 0, stdout: records.map((record) => JSON.stringify(record)).join("\n"), stderr: "" });
const record = (seq, op = "update") => ({ seq, op, issue_id: issue.id, issue: op === "delete" ? null : issue });

function mockMuxy(t, responses, exported = null) {
  const calls = [];
  const original = globalThis.muxy;
  globalThis.muxy = {
    exec: async (argv, options) => {
      calls.push({ argv, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error("Unexpected exec");
      return response;
    },
    files: { read: async () => ({ content: exported }) },
  };
  t.after(() => { globalThis.muxy = original; });
  return calls;
}

function commands(calls) {
  return calls.map((call) => call.argv);
}

function previous(overrides = {}) {
  return {
    ...context,
    issues: [{ ...issue, ready: true, dependencies: [] }],
    source: "bd list --json",
    journalSeq: 3,
    snapshotAt: Date.now(),
    error: null,
    ...overrides,
  };
}

test("baselines the journal before reading issues and readiness in the same workspace", async (t) => {
  const calls = mockMuxy(t, [journal([record(1), record(3)]), ok([issue]), ok([issue])]);
  const data = await loadBoardData(context);
  assert.deepEqual(commands(calls), [eventsCommand(0), listCommand, readyCommand]);
  assert.ok(calls.every(({ options }) => options.cwd === context.workspacePath && options.timeoutMs === 10000));
  assert.equal(data.journalSeq, 3);
  assert.equal(data.issues[0].ready, true);
  assert.equal(data.error, null);
});

test("an empty journal bootstraps once, then an idle tick only tails events", async (t) => {
  const calls = mockMuxy(t, [journal(), ok([]), ok([]), journal()]);
  const baseline = await loadBoardData(context);
  const data = await loadBoardData(context, { previous: baseline });
  assert.equal(baseline.journalSeq, 0);
  assert.equal(data.unchanged, true);
  assert.equal(data.issues, baseline.issues);
  assert.equal(data.snapshotAt, baseline.snapshotAt);
  assert.deepEqual(commands(calls), [eventsCommand(0), listCommand, readyCommand, eventsCommand(0)]);
});

test("idle ticks preserve the snapshot and checkpoint", async (t) => {
  const before = previous();
  const calls = mockMuxy(t, [journal()]);
  const data = await loadBoardData(context, { previous: before });
  assert.equal(data.issues, before.issues);
  assert.equal(data.journalSeq, 3);
  assert.equal(data.unchanged, true);
  assert.deepEqual(commands(calls), [eventsCommand(3)]);
});

for (const op of ["create", "update", "close", "delete", "dep_add", "dep_remove", "comment"]) {
  test(`${op} records trigger a full snapshot instead of replaying incomplete graph data`, async (t) => {
    const updated = { ...issue, title: "Updated", dependencies: [{ depends_on_id: "demo-2", type: "blocks" }], comment_count: 2 };
    const calls = mockMuxy(t, [journal([record(4, op), record(5)]), ok([updated]), ok([])]);
    const data = await loadBoardData(context, { previous: previous() });
    assert.deepEqual(commands(calls), [eventsCommand(3), listCommand, readyCommand]);
    assert.equal(data.journalSeq, 5);
    assert.equal(data.issues[0].title, "Updated");
    assert.equal(data.issues[0].ready, false);
    assert.equal(data.issues[0].comment_count, 2);
    assert.deepEqual(data.issues[0].dependencies, updated.dependencies);
    assert.notEqual(data.unchanged, true);
  });
}

test("events arriving during a snapshot are not skipped", async (t) => {
  const calls = mockMuxy(t, [journal([record(4)]), ok([issue]), ok([]), journal([record(5)]), ok([]), ok([])]);
  const first = await loadBoardData(context, { previous: previous() });
  const second = await loadBoardData(context, { previous: first });
  assert.equal(first.journalSeq, 4);
  assert.equal(second.journalSeq, 5);
  assert.deepEqual(second.issues, []);
  assert.deepEqual(commands(calls), [eventsCommand(3), listCommand, readyCommand, eventsCommand(4), listCommand, readyCommand]);
});

const failures = [
  ["unsupported CLI", { exitCode: 1, stderr: 'unknown command "events"', stdout: "" }],
  ["disabled empty journal", { ...journal(), stderr: "note: the events journal is disabled for this workspace (enable with 'bd config set events-journal true')" }],
  ["disabled journal with old records", { ...journal([record(4)]), stderr: "note: the events journal is disabled for this workspace" }],
  ["unavailable CLI", new Error("bd not found")],
  ["malformed JSONL", { ...journal(), stdout: '{"seq":4}\nnot json' }],
  ["invalid records", journal([{ seq: 4 }])],
  ["null record", journal([null])],
  ["out-of-order records", journal([record(5), record(4)])],
  ["unsafe sequence", journal([record(Number.MAX_SAFE_INTEGER + 1)])],
  ["truncated stdout", { ...journal([record(4)]), truncated: true }],
  ["timed out", { ...journal(), timedOut: true }],
  ["invalid truncation head", { exitCode: 1, stdout: JSON.stringify({ code: "events_journal_truncated", head: -1 }) }],
];

for (const [name, failure] of failures) {
  test(`${name} falls back to full reads without retaining a checkpoint`, async (t) => {
    const calls = mockMuxy(t, [failure, ok([issue]), ok([issue])]);
    const data = await loadBoardData(context, { previous: previous() });
    assert.deepEqual(commands(calls), [eventsCommand(3), listCommand, readyCommand]);
    assert.equal(data.journalSeq, null);
    assert.equal(data.issues[0].ready, true);
    assert.equal(data.error, null);
  });
}

test("a pruned checkpoint rebuilds before resuming at the reported head", async (t) => {
  const truncated = { exitCode: 1, stdout: JSON.stringify({ code: "events_journal_truncated", since: 3, floor: 41, head: 80 }) };
  const calls = mockMuxy(t, [truncated, ok([issue]), ok([]), journal()]);
  const baseline = await loadBoardData(context, { previous: previous() });
  const data = await loadBoardData(context, { previous: baseline });
  assert.equal(baseline.journalSeq, 80);
  assert.equal(data.unchanged, true);
  assert.deepEqual(commands(calls), [eventsCommand(3), listCommand, readyCommand, eventsCommand(80)]);
});

test("manual refresh resets the checkpoint even when the journal is empty", async (t) => {
  const calls = mockMuxy(t, [journal(), ok([issue]), ok([])]);
  const data = await loadBoardData(context, { previous: previous(), force: true });
  assert.equal(data.journalSeq, 0);
  assert.notEqual(data.unchanged, true);
  assert.deepEqual(commands(calls), [eventsCommand(0), listCommand, readyCommand]);
});

test("periodic full reads catch unjournaled syncs and journal resets", async (t) => {
  const calls = mockMuxy(t, [journal([record(1)]), ok([]), ok([])]);
  const data = await loadBoardData(context, { previous: previous({ snapshotAt: Date.now() - 300000 }) });
  assert.equal(data.journalSeq, 1);
  assert.deepEqual(data.issues, []);
  assert.deepEqual(commands(calls), [eventsCommand(0), listCommand, readyCommand]);
});

for (const changed of [{ workspaceKey: "other:clone" }, { workspacePath: "/work/other" }]) {
  test(`changing ${Object.keys(changed)[0]} does not reuse a clone's checkpoint`, async (t) => {
    const calls = mockMuxy(t, [journal([record(1)]), ok([]), ok([])]);
    const data = await loadBoardData({ ...context, ...changed }, { previous: previous() });
    assert.equal(data.journalSeq, 1);
    assert.deepEqual(commands(calls), [eventsCommand(0), listCommand, readyCommand]);
  });
}

test("unknown workspace identity disables the journal optimization", async (t) => {
  const calls = mockMuxy(t, [ok([issue]), ok([])]);
  const data = await loadBoardData({ ...context, workspaceKey: null }, { previous: previous() });
  assert.equal(data.journalSeq, null);
  assert.deepEqual(commands(calls), [listCommand, readyCommand]);
});

test("failed readiness reads are retried rather than cached as caught up", async (t) => {
  const calls = mockMuxy(t, [journal([record(4)]), ok([issue]), { exitCode: 1 }, journal(), ok([issue]), ok([issue])]);
  const failed = await loadBoardData(context, { previous: previous() });
  const recovered = await loadBoardData(context, { previous: failed });
  assert.equal(failed.journalSeq, null);
  assert.equal(recovered.issues[0].ready, true);
  assert.deepEqual(commands(calls), [eventsCommand(3), listCommand, readyCommand, eventsCommand(0), listCommand, readyCommand]);
});

test("failed list reads keep the JSONL fallback and discard the journal checkpoint", async (t) => {
  const calls = mockMuxy(t, [journal([record(4)]), { exitCode: 1, stderr: "database unavailable" }], JSON.stringify(issue));
  const data = await loadBoardData(context, { previous: previous() });
  assert.equal(data.source, "issues.jsonl");
  assert.equal(data.journalSeq, null);
  assert.equal(data.issues[0].id, issue.id);
  assert.deepEqual(commands(calls), [eventsCommand(3), listCommand]);
});

test("cached snapshots without a live checkpoint always get a fresh baseline", async (t) => {
  const calls = mockMuxy(t, [journal(), ok([issue]), ok([])]);
  const data = await loadBoardData(context, { previous: previous({ journalSeq: undefined }) });
  assert.equal(data.journalSeq, 0);
  assert.deepEqual(commands(calls), [eventsCommand(0), listCommand, readyCommand]);
});

test("enabling a previously disabled journal takes a fresh baseline", async (t) => {
  const calls = mockMuxy(t, [journal([record(1)]), ok([issue]), ok([])]);
  const data = await loadBoardData(context, { previous: previous({ journalSeq: null }) });
  assert.equal(data.journalSeq, 1);
  assert.deepEqual(commands(calls), [eventsCommand(0), listCommand, readyCommand]);
});
