import test from "node:test";
import assert from "node:assert/strict";

import { normalizeConfig } from "../src/shared/format.js";
import * as Pomo from "../src/shared/pomo.js";

const cfg = normalizeConfig(null); // 25/5/15, cadence 4, autoStartBreaks on, autoStartFocus off
const T0 = new Date(2026, 8, 14, 10, 0, 0).getTime();
const MIN = 60_000;

test("start opens a 25-minute focus attributed to the active project", () => {
  const p = Pomo.start(Pomo.initialPomo(), cfg, T0, "p1");
  assert.equal(p.phase, "focus");
  assert.equal(p.endsAt, T0 + 25 * MIN);
  assert.equal(p.projectID, "p1");
  assert.ok(Pomo.isRunning(p));
});

test("pause stores remaining time; resume restores it exactly", () => {
  let p = Pomo.start(Pomo.initialPomo(), cfg, T0, "p1");
  p = Pomo.pause(p, T0 + 10 * MIN);
  assert.ok(Pomo.isPaused(p));
  assert.equal(p.remainingMs, 15 * MIN);
  p = Pomo.resume(p, T0 + 60 * MIN);
  assert.equal(p.endsAt, T0 + 75 * MIN);
});

test("toggle cycles start → pause → resume", () => {
  let r = Pomo.toggle(Pomo.initialPomo(), cfg, T0, "p1");
  assert.equal(r.action, "started");
  r = Pomo.toggle(r.pomo, cfg, T0 + MIN, "p1");
  assert.equal(r.action, "paused");
  r = Pomo.toggle(r.pomo, cfg, T0 + 2 * MIN, "p1");
  assert.equal(r.action, "resumed");
  assert.equal(r.pomo.endsAt, T0 + 2 * MIN + 24 * MIN);
});

test("focus completion starts the break and reports the event", () => {
  const p = Pomo.start(Pomo.initialPomo(), cfg, T0, "p1");
  const { pomo, events } = Pomo.expire(p, cfg, T0 + 25 * MIN + 1000, "p1");
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "focus-complete");
  assert.equal(events[0].silent, false);
  assert.equal(events[0].projectID, "p1");
  assert.equal(pomo.phase, "break");
  assert.equal(pomo.cycle, 1);
  assert.equal(pomo.endsAt, T0 + 30 * MIN); // break starts when focus ended, not when we noticed
});

test("every 4th completed focus earns the long break", () => {
  let p = { ...Pomo.start(Pomo.initialPomo(), cfg, T0, "p1"), cycle: 3 };
  const { pomo } = Pomo.expire(p, cfg, T0 + 25 * MIN + 1000, "p1");
  assert.equal(pomo.phase, "longBreak");
  assert.equal(pomo.cycle, 4);
});

test("break end without auto-start invites the next focus", () => {
  const p = { ...Pomo.initialPomo(), phase: "break", endsAt: T0, cycle: 1 };
  const { pomo, events } = Pomo.expire(p, cfg, T0 + 1000, "p1");
  assert.equal(events[0].kind, "break-over");
  assert.equal(pomo.phase, "idle");
  assert.equal(pomo.pending, "focus");
});

test("auto-start focus flows straight into the next session", () => {
  const auto = normalizeConfig({ pomo: { autoStartFocus: true } });
  const p = { ...Pomo.initialPomo(), phase: "break", endsAt: T0, cycle: 1 };
  const { pomo } = Pomo.expire(p, auto, T0 + 1000, "p2");
  assert.equal(pomo.phase, "focus");
  assert.equal(pomo.projectID, "p2");
  assert.equal(pomo.endsAt, T0 + 25 * MIN);
});

test("long break completion resets the cadence cycle", () => {
  const p = { ...Pomo.initialPomo(), phase: "longBreak", endsAt: T0, cycle: 4 };
  const { pomo } = Pomo.expire(p, cfg, T0 + 1000, "p1");
  assert.equal(pomo.cycle, 0);
});

test("phases that expired during sleep complete silently, chained", () => {
  // Lid closed 5 minutes into a focus; wake 2 hours later. The focus ended
  // and its auto-started break also ended — both silently.
  const p = Pomo.start(Pomo.initialPomo(), cfg, T0, "p1");
  const { pomo, events } = Pomo.expire(p, cfg, T0 + 120 * MIN, "p1");
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "focus-complete");
  assert.equal(events[0].silent, true);
  assert.equal(events[1].kind, "break-over");
  assert.equal(events[1].silent, true);
  assert.equal(pomo.phase, "idle");
  assert.equal(pomo.pending, "focus");
  assert.equal(pomo.cycle, 1);
});

test("skip advances without completion credit", () => {
  let p = Pomo.start(Pomo.initialPomo(), cfg, T0, "p1");
  p = Pomo.skip(p, cfg, T0 + 5 * MIN, "p1");
  assert.equal(p.phase, "break");
  assert.equal(p.cycle, 0); // no credit
  p = Pomo.skip(p, cfg, T0 + 6 * MIN, "p1");
  assert.equal(p.phase, "focus");
});

test("a skipped 4th focus still leads to the long break", () => {
  const p = { ...Pomo.start(Pomo.initialPomo(), cfg, T0, "p1"), cycle: 3 };
  const skipped = Pomo.skip(p, cfg, T0 + 5 * MIN, "p1");
  assert.equal(skipped.phase, "longBreak");
});

test("abandon returns to idle without credit", () => {
  const p = Pomo.start(Pomo.initialPomo(), cfg, T0, "p1");
  const done = Pomo.abandon(p);
  assert.equal(done.phase, "idle");
  assert.equal(done.endsAt, null);
  assert.equal(done.pending, null);
});

test("expire is a no-op while a phase is paused", () => {
  let p = Pomo.start(Pomo.initialPomo(), cfg, T0, "p1");
  p = Pomo.pause(p, T0 + MIN);
  const { pomo, events } = Pomo.expire(p, cfg, T0 + 120 * MIN, "p1");
  assert.equal(events.length, 0);
  assert.ok(Pomo.isPaused(pomo));
});

test("describe reports remaining time and cadence dots", () => {
  const p = Pomo.start(Pomo.initialPomo(), cfg, T0, "p1");
  const d = Pomo.describe(p, cfg, T0 + 60_000);
  assert.equal(d.remainingMs, 24 * MIN);
  assert.equal(d.cadence, 4);
  assert.equal(d.dotsFilled, 0);
  const d2 = Pomo.describe({ ...p, cycle: 2 }, cfg, T0);
  assert.equal(d2.dotsFilled, 2);
});
