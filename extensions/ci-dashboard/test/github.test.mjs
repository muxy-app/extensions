// The GitHub provider, exercised against JSON recorded from the real `gh` CLI
// (see test/fixtures). `window.muxy.exec` is stubbed to replay those recordings,
// so the whole provider path runs — argv construction included.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as github from "../src/providers/github.js";
import { STATUS, durationMs } from "../src/model.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (name) => fs.readFileSync(path.join(fixtures, name), "utf8");

const SOURCE = { id: "gh1", kind: "github", label: "GitHub Actions", enabled: true };

/** Replays a recorded stdout and captures the argv the provider built. */
function stubExec(stdout, { exitCode = 0, stderr = "" } = {}) {
  const calls = [];
  globalThis.window = {
    muxy: {
      exec: async (argv) => {
        calls.push(argv);
        return { stdout, stderr, exitCode };
      },
    },
  };
  return calls;
}

test("loadRuns maps recorded gh output onto normalized runs", async () => {
  stubExec(load("gh-run-list.json"));
  const runs = await github.loadRuns(SOURCE, "/repo");

  assert.ok(runs.length > 0);
  for (const run of runs) {
    assert.equal(run.sourceKind, "github");
    assert.equal(run.source, "gh1");
    assert.ok(run.id, "every run has an id");
    assert.ok(run.webUrl.startsWith("https://"), "every run has a web URL to open");
    assert.ok(Object.values(STATUS).includes(run.status), `unmapped status: ${run.status}`);
    assert.match(run.number, /^#\d+$/);
  }
});

test("loadRuns passes the branch filter and limit through to gh", async () => {
  const calls = stubExec("[]");
  await github.loadRuns(SOURCE, "/repo", { branch: "release/2.1", limit: 15 });

  const argv = calls[0];
  assert.deepEqual(argv.slice(0, 3), ["gh", "run", "list"]);
  assert.equal(argv[argv.indexOf("-b") + 1], "release/2.1");
  assert.equal(argv[argv.indexOf("-L") + 1], "15");
});

test("a completed run keeps its finish time; an in-flight one does not", async () => {
  stubExec(load("gh-run-list-mixed.json"));
  const runs = await github.loadRuns(SOURCE, "/repo");

  const active = runs.filter((r) => r.status === STATUS.running || r.status === STATUS.queued);
  const done = runs.filter((r) => r.status === STATUS.failed || r.status === STATUS.canceled);
  assert.ok(active.length, "fixture should contain an in-flight run");
  assert.ok(done.length, "fixture should contain a finished run");

  // updatedAt keeps moving while a run is in flight, so it must not be treated
  // as a finish time — otherwise the duration stops ticking.
  for (const run of active) assert.equal(run.finishedAt, "");
  for (const run of done) assert.ok(run.finishedAt, "a finished run reports when it ended");
});

test("recorded failures and cancellations map to distinct statuses", async () => {
  stubExec(load("gh-run-list-mixed.json"));
  const statuses = new Set((await github.loadRuns(SOURCE, "/repo")).map((r) => r.status));
  assert.ok(statuses.has(STATUS.failed), "conclusion 'failure' maps to failed");
  assert.ok(statuses.has(STATUS.canceled), "conclusion 'cancelled' maps to canceled");
});

test("loadRun maps recorded jobs and their steps", async () => {
  stubExec(load("gh-run-view.json"));
  const run = await github.loadRun(SOURCE, "/repo", 1);

  assert.ok(Array.isArray(run.jobs) && run.jobs.length, "jobs are mapped");
  for (const job of run.jobs) {
    assert.ok(job.id && job.name);
    assert.ok(Object.values(STATUS).includes(job.status));
    assert.ok(Array.isArray(job.steps));
    // A duration is either unavailable or sane — never negative. GitHub stamps
    // some skipped jobs as completing before they started.
    const ms = durationMs(job);
    assert.ok(ms === null || ms >= 0, `bad duration for job ${job.name}: ${ms}`);
  }
  assert.ok(run.jobs.some((j) => durationMs(j) !== null), "at least one job reports a duration");
});

test("retry targets the failed jobs, the whole run, or one job", async () => {
  let calls = stubExec("");
  await github.retry(SOURCE, "/repo", 42, { failedOnly: true });
  assert.deepEqual(calls[0], ["gh", "run", "rerun", "42", "--failed"]);

  calls = stubExec("");
  await github.retry(SOURCE, "/repo", 42, { failedOnly: false });
  assert.deepEqual(calls[0], ["gh", "run", "rerun", "42"]);

  calls = stubExec("");
  await github.retry(SOURCE, "/repo", 42, { jobId: "99" });
  assert.deepEqual(calls[0], ["gh", "run", "rerun", "--job", "99"]);
});

test("cancel targets the run", async () => {
  const calls = stubExec("");
  await github.cancel(SOURCE, "/repo", 42);
  assert.deepEqual(calls[0], ["gh", "run", "cancel", "42"]);
});

test("an expired log resolves empty instead of breaking the detail view", async () => {
  stubExec("", { exitCode: 1, stderr: "log not found" });
  assert.equal(await github.loadFailureLog(SOURCE, "/repo", 42), "");
});

test("a missing gh binary propagates as a 'missing' error", async () => {
  stubExec("", { exitCode: 127, stderr: "command not found: gh" });
  await assert.rejects(
    () => github.loadRuns(SOURCE, "/repo"),
    (e) => e.kind === "missing",
  );
});
