import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeConfig,
  dayKey,
  splitByDay,
  addDays,
  fmtDuration,
  fmtCountdown,
  fmtClock,
} from "../src/shared/format.js";

test("normalizeConfig fills defaults and clamps", () => {
  const c = normalizeConfig(null);
  assert.equal(c.mode, "muxy");
  assert.equal(c.idleSec, 120);
  assert.equal(c.pomo.focusMin, 25);
  assert.equal(c.workHours, null);

  const clamped = normalizeConfig({ idleSec: 1, pomo: { focusMin: 9999 }, mode: "machine" });
  assert.equal(clamped.idleSec, 30);
  assert.equal(clamped.pomo.focusMin, 240);
  assert.equal(clamped.mode, "machine");
});

test("normalizeConfig rejects malformed work hours", () => {
  assert.equal(normalizeConfig({ workHours: { start: "9am", end: "18:00" } }).workHours, null);
  assert.equal(normalizeConfig({ workHours: { start: "09:00", end: "09:00" } }).workHours, null);
  assert.deepEqual(normalizeConfig({ workHours: { start: "09:00", end: "18:00" } }).workHours, {
    start: "09:00",
    end: "18:00",
  });
});

test("dayKey is a local-date string", () => {
  assert.equal(dayKey(new Date(2026, 8, 14, 0, 0, 1).getTime()), "2026-09-14");
  assert.equal(dayKey(new Date(2026, 8, 14, 23, 59, 59).getTime()), "2026-09-14");
});

test("splitByDay splits across local midnight", () => {
  const from = new Date(2026, 8, 14, 23, 30).getTime();
  const to = new Date(2026, 8, 15, 0, 30).getTime();
  const parts = splitByDay(from, to);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0], { day: "2026-09-14", seconds: 1800 });
  assert.deepEqual(parts[1], { day: "2026-09-15", seconds: 1800 });
});

test("splitByDay of an empty span is empty", () => {
  const at = new Date(2026, 8, 14, 12, 0).getTime();
  assert.deepEqual(splitByDay(at, at), []);
});

test("addDays crosses month boundaries", () => {
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

test("duration formats", () => {
  assert.equal(fmtDuration(0), "0m");
  assert.equal(fmtDuration(59), "1m");
  assert.equal(fmtDuration(6120), "1h 42m");
  assert.equal(fmtDuration(7200), "2h");
});

test("countdown formats: minutes, then seconds under the final minute", () => {
  assert.equal(fmtCountdown(24 * 60_000), "24m");
  assert.equal(fmtCountdown(61_000), "2m");
  assert.equal(fmtCountdown(45_000), "45s");
  assert.equal(fmtClock(1_437_000), "23:57");
});
