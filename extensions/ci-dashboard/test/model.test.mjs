import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeStatus, STATUS, durationMs, formatDuration, jobSummary,
  lastGreenBefore, sortRuns, filterByBranch, isActive, isTerminal,
} from "../src/model.js";

test("normalizeStatus prefers a conclusion over the status", () => {
  // GitHub reports status "completed" plus the conclusion that matters.
  assert.equal(normalizeStatus("completed", "failure"), STATUS.failed);
  assert.equal(normalizeStatus("completed", "success"), STATUS.success);
  assert.equal(normalizeStatus("in_progress", ""), STATUS.running);
});

test("normalizeStatus covers the GitLab and CCTray vocabularies", () => {
  assert.equal(normalizeStatus("running"), STATUS.running);
  assert.equal(normalizeStatus("canceled"), STATUS.canceled);
  assert.equal(normalizeStatus("cancelled"), STATUS.canceled);
  assert.equal(normalizeStatus("manual"), STATUS.manual);
  assert.equal(normalizeStatus("Success"), STATUS.success);
  assert.equal(normalizeStatus("Failure"), STATUS.failed);
  assert.equal(normalizeStatus("waiting_for_resource"), STATUS.queued);
  assert.equal(normalizeStatus(""), STATUS.unknown);
  assert.equal(normalizeStatus("something-new"), STATUS.unknown);
});

test("isActive and isTerminal split the statuses cleanly", () => {
  assert.ok(isActive(STATUS.running) && isActive(STATUS.queued));
  assert.ok(!isActive(STATUS.success));
  assert.ok(isTerminal(STATUS.failed) && isTerminal(STATUS.skipped));
  assert.ok(!isTerminal(STATUS.running));
});

test("durationMs uses an explicit value, then the timestamp pair", () => {
  assert.equal(durationMs({ durationMs: 5000 }), 5000);
  assert.equal(durationMs({
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:02:30Z",
  }), 150000);
  assert.equal(durationMs({}), null);
});

test("durationMs measures a running job against now", () => {
  const started = new Date(Date.now() - 30000).toISOString();
  const ms = durationMs({ startedAt: started, status: STATUS.running });
  assert.ok(ms >= 29000 && ms <= 32000, `got ${ms}`);
});

test("durationMs does not let a finished item with no end time grow forever", () => {
  const started = new Date(Date.now() - 30000).toISOString();
  // A terminal status with no finishedAt must not be measured against now.
  assert.equal(durationMs({ startedAt: started, status: STATUS.skipped }), null);
  assert.equal(durationMs({ startedAt: started, status: STATUS.success }), null);
});

test("durationMs discards a negative span", () => {
  // GitHub stamps a skipped job's completedAt before its startedAt.
  assert.equal(durationMs({
    startedAt: "2026-08-26T14:21:39Z",
    finishedAt: "2026-08-26T14:21:32Z",
    status: STATUS.skipped,
  }), null);
});

test("formatDuration is compact at every scale", () => {
  assert.equal(formatDuration(9000), "9s");
  assert.equal(formatDuration(150000), "2m 30s");
  assert.equal(formatDuration(7500000), "2h 5m");
  assert.equal(formatDuration(null), "");
});

test("jobSummary counts each status", () => {
  const counts = jobSummary([
    { status: STATUS.success }, { status: STATUS.success }, { status: STATUS.failed },
  ]);
  assert.deepEqual(counts, { success: 2, failed: 1 });
});

test("lastGreenBefore finds the newest success before a run on the same branch", () => {
  const runs = [
    { id: "3", source: "s", status: STATUS.failed, sha: "ccc", branch: "main", createdAt: "2026-01-03T00:00:00Z" },
    { id: "2", source: "s", status: STATUS.success, sha: "bbb", branch: "main", createdAt: "2026-01-02T00:00:00Z" },
    { id: "1", source: "s", status: STATUS.success, sha: "aaa", branch: "main", createdAt: "2026-01-01T00:00:00Z" },
  ];
  assert.equal(lastGreenBefore(runs, runs[0]).sha, "bbb");
});

test("lastGreenBefore ignores other branches, other sources and later runs", () => {
  const target = { id: "x", source: "s", status: STATUS.failed, sha: "zzz", branch: "main", createdAt: "2026-01-02T00:00:00Z" };
  const runs = [
    target,
    { id: "a", source: "s", status: STATUS.success, sha: "aaa", branch: "dev", createdAt: "2026-01-01T00:00:00Z" },
    { id: "b", source: "other", status: STATUS.success, sha: "bbb", branch: "main", createdAt: "2026-01-01T00:00:00Z" },
    { id: "c", source: "s", status: STATUS.success, sha: "ccc", branch: "main", createdAt: "2026-01-03T00:00:00Z" },
  ];
  assert.equal(lastGreenBefore(runs, target), null);
});

test("sortRuns puts the newest first", () => {
  const runs = [
    { id: "old", createdAt: "2026-01-01T00:00:00Z" },
    { id: "new", createdAt: "2026-01-05T00:00:00Z" },
  ];
  assert.deepEqual(sortRuns(runs).map((r) => r.id), ["new", "old"]);
});

test("filterByBranch keeps runs with no branch, so status-only feeds still show", () => {
  const runs = [{ branch: "main" }, { branch: "dev" }, { branch: "" }];
  assert.equal(filterByBranch(runs, "main").length, 2);
  assert.equal(filterByBranch(runs, "").length, 3);
});

test("durationMs reports nothing when only a finish time is known", () => {
  // CCTray publishes lastBuildTime and no start, so a duration is unknowable.
  assert.equal(durationMs({ finishedAt: "2026-08-26T10:30:34Z", status: STATUS.success }), null);
});

test("durationMs measures a queued run from when it was created", () => {
  const created = new Date(Date.now() - 12000).toISOString();
  const ms = durationMs({ createdAt: created, status: STATUS.queued });
  assert.ok(ms >= 11000 && ms <= 14000, `got ${ms}`);
});
