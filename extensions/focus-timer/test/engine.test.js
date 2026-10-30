import test from "node:test";
import assert from "node:assert/strict";

import { normalizeConfig } from "../src/shared/format.js";
import {
  initialEngine,
  initialAgents,
  step,
  agentStatus,
  agentGap,
  inWorkHours,
  lastFenceEnd,
} from "../src/shared/engine.js";

const cfg = normalizeConfig(null); // muxy mode, idle 120 s, no fence
const T0 = new Date(2026, 8, 14, 10, 0, 0).getTime(); // local 10:00

const sum = (deltas) => deltas.reduce((s, d) => s + d.seconds, 0);

function ctx(state, at, projectID = "p1", worktreeID = "w1", config = cfg) {
  return step(state, { type: "context", at, projectID, worktreeID }, config);
}

function probe(state, at, { active = true, idleMs = 1000 } = {}, config = cfg) {
  return step(state, { type: "probe", at, active, idleMs }, config);
}

test("context event opens a segment; attribution change closes and reopens", () => {
  let r = ctx(initialEngine(), T0);
  assert.ok(r.state.segment);
  assert.equal(r.state.segment.projectID, "p1");
  assert.deepEqual(r.deltas, []);

  r = ctx(r.state, T0 + 600_000, "p2", "w2");
  assert.equal(r.deltas.length, 1);
  assert.equal(r.deltas[0].projectID, "p1");
  assert.equal(r.deltas[0].worktreeID, "w1");
  assert.equal(r.deltas[0].series, "you");
  assert.equal(r.deltas[0].seconds, 600);
  assert.equal(r.state.segment.projectID, "p2");
});

test("no attribution before the first event — probes alone open nothing", () => {
  const r = probe(initialEngine(), T0, { active: true, idleMs: 500 });
  assert.equal(r.state.segment, null);
});

test("idle-threshold crossing closes backdated to when input stopped", () => {
  let r = ctx(initialEngine(), T0);
  for (let beat = 1; beat <= 13; beat += 1) {
    r = probe(r.state, T0 + beat * 30_000, { active: true, idleMs: 2_000 });
    assert.ok(r.state.segment, `segment survives active beat ${beat}`);
  }
  // Idle climbs: 115 s at T0+420 s is still under the 120 s threshold…
  r = probe(r.state, T0 + 420_000, { active: true, idleMs: 115_000 });
  assert.ok(r.state.segment);
  // …then 145 s at T0+450 s crosses it → input stopped at T0+305 s.
  r = probe(r.state, T0 + 450_000, { active: false, idleMs: 145_000 });
  assert.equal(r.state.segment, null);
  assert.equal(sum(r.deltas), 305);
});

test("losing frontmost (idle still low) closes at the previous heartbeat", () => {
  let r = ctx(initialEngine(), T0);
  r = probe(r.state, T0 + 30_000, { active: true, idleMs: 1_000 });
  r = probe(r.state, T0 + 60_000, { active: false, idleMs: 5_000 });
  assert.equal(r.state.segment, null);
  assert.equal(sum(r.deltas), 30);
});

test("an active probe reopens, capturing the run-up within the beat", () => {
  let r = ctx(initialEngine(), T0);
  r = probe(r.state, T0 + 30_000, { active: false, idleMs: 5_000 }); // closed
  assert.equal(r.state.segment, null);
  r = probe(r.state, T0 + 60_000, { active: true, idleMs: 12_000 });
  assert.ok(r.state.segment);
  assert.equal(r.state.segment.startedAt, T0 + 48_000); // at − idle
});

test("sleep gap closes retroactively at the last heartbeat", () => {
  let r = ctx(initialEngine(), T0);
  r = probe(r.state, T0 + 30_000, { active: true, idleMs: 1_000 });
  // Lid closed; next beat is an hour later.
  r = probe(r.state, T0 + 3_630_000, { active: true, idleMs: 2_000 });
  assert.equal(r.gap, true);
  assert.equal(sum(r.deltas), 30); // only T0 → T0+30 s counted
  assert.ok(r.state.segment); // reopened on the active wake beat
  assert.equal(r.state.segment.startedAt, T0 + 3_628_000);
});

test("segments split across local midnight in the rollup deltas", () => {
  const lateNight = new Date(2026, 8, 14, 23, 30).getTime();
  let r = ctx(initialEngine(), lateNight);
  r = ctx(r.state, lateNight + 3_600_000, "p2", "w2");
  assert.equal(r.deltas.length, 2);
  assert.equal(r.deltas[0].day, "2026-09-14");
  assert.equal(r.deltas[0].seconds, 1800);
  assert.equal(r.deltas[1].day, "2026-09-15");
  assert.equal(r.deltas[1].seconds, 1800);
});

test("degraded mode: events open segments, assume-active expiry closes them", () => {
  let r = step(initialEngine(), { type: "probeFail", at: T0 }, cfg);
  assert.equal(r.state.degraded, true);
  r = ctx(r.state, T0 + 10_000); // event = evidence, opens
  assert.ok(r.state.segment);
  assert.equal(r.state.segment.degraded, true);

  let closed = [];
  for (let at = T0 + 30_000; at <= T0 + 640_000; at += 30_000) {
    r = step(r.state, { type: "probeFail", at }, cfg);
    closed = closed.concat(r.deltas);
  }
  // Expiry = last activity (T0+10 s) + 10 min.
  assert.equal(r.state.segment, null);
  assert.equal(sum(closed), 600);
  assert.equal(closed[0].degraded, true);
});

test("probe recovery clears degraded and later closes are exact", () => {
  let r = step(initialEngine(), { type: "probeFail", at: T0 }, cfg);
  r = ctx(r.state, T0 + 5_000);
  r = probe(r.state, T0 + 30_000, { active: true, idleMs: 1_000 });
  assert.equal(r.state.degraded, false);
  // The segment was opened under degraded mode, so its time stays flagged.
  r = probe(r.state, T0 + 60_000, { active: false, idleMs: 5_000 });
  assert.equal(r.deltas[0].degraded, true);
});

test("pause closes immediately; resume reopens on fresh probe evidence", () => {
  let r = ctx(initialEngine(), T0);
  r = probe(r.state, T0 + 30_000, { active: true, idleMs: 1_000 });
  r = step(r.state, { type: "pause", at: T0 + 300_000 }, cfg);
  assert.equal(r.state.segment, null);
  assert.equal(sum(r.deltas), 300);

  const paused = normalizeConfig({ paused: true });
  r = probe(r.state, T0 + 330_000, { active: true, idleMs: 1_000 }, paused);
  assert.equal(r.state.segment, null); // paused → no reopen

  r = step(r.state, { type: "resume", at: T0 + 350_000 }, cfg);
  assert.ok(r.state.segment); // last probe was active and fresh
  assert.equal(r.state.segment.startedAt, T0 + 350_000);
});

test("mode switch closes the open segment", () => {
  let r = ctx(initialEngine(), T0);
  r = step(r.state, { type: "modeChanged", at: T0 + 120_000 }, cfg);
  assert.equal(r.state.segment, null);
  assert.equal(sum(r.deltas), 120);
});

test("working-hours fence: probe outside hours closes at the fence end", () => {
  const fenced = normalizeConfig({ workHours: { start: "09:00", end: "18:00" } });
  const t1730 = new Date(2026, 8, 14, 17, 30).getTime();
  let r = ctx(initialEngine(), t1730, "p1", "w1", fenced);
  assert.ok(r.state.segment);
  const t1810 = new Date(2026, 8, 14, 18, 10).getTime();
  r = probe(r.state, t1810, { active: true, idleMs: 1_000 }, fenced);
  assert.equal(r.state.segment, null);
  assert.equal(sum(r.deltas), 1800); // 17:30 → 18:00 only
});

test("inWorkHours handles overnight windows", () => {
  const night = normalizeConfig({ workHours: { start: "20:00", end: "02:00" } });
  assert.equal(inWorkHours(night, new Date(2026, 8, 14, 21, 0).getTime()), true);
  assert.equal(inWorkHours(night, new Date(2026, 8, 15, 1, 0).getTime()), true);
  assert.equal(inWorkHours(night, new Date(2026, 8, 14, 12, 0).getTime()), false);
});

test("lastFenceEnd finds the most recent boundary", () => {
  const fenced = normalizeConfig({ workHours: { start: "09:00", end: "18:00" } });
  const t1810 = new Date(2026, 8, 14, 18, 10).getTime();
  assert.equal(lastFenceEnd(fenced, t1810), new Date(2026, 8, 14, 18, 0).getTime());
  const t0800 = new Date(2026, 8, 14, 8, 0).getTime();
  assert.equal(lastFenceEnd(fenced, t0800), new Date(2026, 8, 13, 18, 0).getTime());
});

// ── agent meter ─────────────────────────────────────────────────────────────

test("agent working→idle accumulates per project and worktree", () => {
  let r = agentStatus(initialAgents(), { at: T0, worktreeID: "w1", projectID: "p1", status: "working" });
  assert.ok(r.agents.w1);
  r = agentStatus(r.agents, { at: T0 + 900_000, worktreeID: "w1", projectID: "p1", status: "idle" });
  assert.equal(r.agents.w1, undefined);
  assert.equal(r.deltas.length, 1);
  assert.equal(r.deltas[0].series, "agent");
  assert.equal(r.deltas[0].seconds, 900);
  assert.equal(r.deltas[0].worktreeID, "w1");
});

test("agent waiting also closes the working segment", () => {
  let r = agentStatus(initialAgents(), { at: T0, worktreeID: "w1", projectID: "p1", status: "working" });
  r = agentStatus(r.agents, { at: T0 + 60_000, worktreeID: "w1", projectID: "p1", status: "waiting" });
  assert.equal(sum(r.deltas), 60);
});

test("duplicate working events don't reset the segment start", () => {
  let r = agentStatus(initialAgents(), { at: T0, worktreeID: "w1", projectID: "p1", status: "working" });
  r = agentStatus(r.agents, { at: T0 + 60_000, worktreeID: "w1", projectID: "p1", status: "working" });
  assert.equal(r.agents.w1.startedAt, T0);
});

test("agentGap closes at the last heartbeat and reopens at wake", () => {
  let r = agentStatus(initialAgents(), { at: T0, worktreeID: "w1", projectID: "p1", status: "working" });
  const { agents, deltas } = agentGap(r.agents, T0 + 30_000, T0 + 3_600_000);
  assert.equal(sum(deltas), 30);
  assert.equal(agents.w1.startedAt, T0 + 3_600_000);
});
