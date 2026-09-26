import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDeltas,
  addPomo,
  mergeDays,
  pruneDays,
  sliceRange,
  daySummary,
  pushPomoLog,
  settlePomoLog,
  mergePomoLog,
} from "../src/shared/rollup.js";

const delta = (over = {}) => ({
  day: "2026-09-14",
  projectID: "p1",
  worktreeID: "w1",
  series: "you",
  seconds: 60,
  ...over,
});

test("applyDeltas folds you/agent series into projects and worktrees", () => {
  const days = {};
  applyDeltas(days, [delta(), delta({ series: "agent", seconds: 30 }), delta({ worktreeID: null, seconds: 10 })]);
  const day = days["2026-09-14"];
  assert.equal(day.projects.p1.you, 70);
  assert.equal(day.projects.p1.agent, 30);
  assert.equal(day.worktrees.w1.you, 60);
  assert.equal(day.worktrees.w1.agent, 30);
  assert.equal(day.degraded, undefined);
});

test("degraded deltas flag the day", () => {
  const days = {};
  applyDeltas(days, [delta({ degraded: true })]);
  assert.equal(days["2026-09-14"].degraded, true);
});

test("invalid deltas are ignored", () => {
  const days = {};
  applyDeltas(days, [delta({ seconds: 0 }), delta({ projectID: null }), null]);
  assert.deepEqual(days, {});
});

test("addPomo attributes to the session's project", () => {
  const days = {};
  addPomo(days, "2026-09-14", "p1");
  addPomo(days, "2026-09-14", "p1");
  assert.equal(days["2026-09-14"].projects.p1.pomos, 2);
});

test("mergeDays sums leafwise and preserves degraded", () => {
  const base = {};
  applyDeltas(base, [delta({ seconds: 100 })]);
  const add = {};
  applyDeltas(add, [delta({ seconds: 50, degraded: true }), delta({ day: "2026-09-15", seconds: 10 })]);
  const merged = mergeDays(base, add);
  assert.equal(merged["2026-09-14"].projects.p1.you, 150);
  assert.equal(merged["2026-09-14"].degraded, true);
  assert.equal(merged["2026-09-15"].projects.p1.you, 10);
  // Inputs are untouched.
  assert.equal(base["2026-09-14"].projects.p1.you, 100);
});

test("pruneDays drops rollups older than the retention window", () => {
  const days = { "2020-01-01": { projects: {}, worktrees: {} }, "2026-09-14": { projects: {}, worktrees: {} } };
  pruneDays(days, "2026-09-14", 400);
  assert.equal(days["2020-01-01"], undefined);
  assert.ok(days["2026-09-14"]);
});

test("sliceRange filters by sortable day keys", () => {
  const days = {};
  applyDeltas(days, [delta({ day: "2026-09-10" }), delta({ day: "2026-09-14" }), delta({ day: "2026-09-20" })]);
  const slice = sliceRange(days, "2026-09-11", "2026-09-19");
  assert.deepEqual(Object.keys(slice), ["2026-09-14"]);
});

test("daySummary totals and sorts projects by your time", () => {
  const days = {};
  applyDeltas(days, [
    delta({ projectID: "p1", seconds: 100 }),
    delta({ projectID: "p2", seconds: 300 }),
    delta({ projectID: "p2", series: "agent", seconds: 40 }),
  ]);
  addPomo(days, "2026-09-14", "p1");
  const s = daySummary(days, "2026-09-14");
  assert.equal(s.total, 400);
  assert.equal(s.agentTotal, 40);
  assert.equal(s.pomos, 1);
  assert.equal(s.byProject[0].projectID, "p2");
});

test("pomoLog ring buffer caps at 200 and settles by startedAt", () => {
  let log = [];
  for (let i = 0; i < 250; i += 1) {
    log = pushPomoLog(log, { startedAt: i, minutes: 25, projectID: "p1", completed: false });
  }
  assert.equal(log.length, 200);
  assert.equal(log[0].startedAt, 249);

  log = settlePomoLog(log, 249, true);
  assert.equal(log[0].completed, true);

  const merged = mergePomoLog(log.slice(0, 5), log.slice(3, 10));
  assert.equal(merged.length, 10);
  assert.equal(merged[0].startedAt, 249);
});
