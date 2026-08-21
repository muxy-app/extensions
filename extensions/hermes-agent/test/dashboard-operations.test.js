import assert from "node:assert/strict";
import test from "node:test";

import {
  DashboardOperationsClient,
  formatScheduleCadence,
  normalizeGatewayHealth,
  normalizeQueueStats,
  normalizeScheduledJobs,
} from "../src/dashboard-operations.js";

function sessionFixture(overrides = {}) {
  const calls = [];
  return {
    calls,
    async requestJson({ url }) {
      calls.push(url);
      if (url.endsWith("/api/status")) return overrides.health ?? {
        status: 200,
        body: { gateway_running: true, memory: { pressure: "elevated", gateway_rss_mb: 900 }, disk: { pressure: "ok", free_mb: 10_000 } },
      };
      if (url.includes("/api/cron/jobs")) return overrides.jobs ?? {
        status: 200,
        body: [
          {
            id: "daily-review",
            name: "Daily review",
            enabled: true,
            state: "scheduled",
            next_run_at: "2026-08-20T13:00:00Z",
            last_status: "success",
            schedule: { kind: "cron", expr: "0 12 * * *", display: "0 12 * * *" },
            prompt: "must-not-survive",
            script: "must-not-survive",
            workdir: "/must/not/survive",
          },
          {
            id: "broken-sync",
            name: "Broken sync",
            enabled: true,
            last_status: "failed",
            last_error: "private provider failure",
            next_run_at: "2026-08-21T13:00:00Z",
            schedule: { kind: "interval", minutes: 15, display: "every 15m" },
          },
        ],
      };
      if (url.includes("/workers/active")) return overrides.workers ?? { status: 200, body: { count: 2, workers: [{ worker_pid: 9876, claim_lock: "private" }] } };
      if (url.includes("/diagnostics")) return overrides.diagnostics ?? { status: 200, body: { count: 3, diagnostics: [{ detail: "private detail" }] } };
      if (url.includes("/stats")) return overrides.queue ?? {
        status: 200,
        body: { by_status: { ready: 5, running: 2, blocked: 1, review: 4 }, oldest_ready_age_seconds: 720 },
      };
      throw new Error(`unexpected request: ${url}`);
    },
  };
}

test("operations client projects bounded attention, queue, schedule, and health data", async () => {
  const session = sessionFixture();
  const client = new DashboardOperationsClient({
    baseUrl: "http://127.0.0.1:9119",
    session,
    board: "default",
    now: () => 1_777_777_777_000,
  });
  const snapshot = await client.load();

  assert.equal(snapshot.state, "ready");
  assert.deepEqual(snapshot.queue, {
    byStatus: { triage: 0, todo: 0, scheduled: 0, ready: 5, running: 2, blocked: 1, review: 4, done: 0 },
    waiting: 5,
    running: 2,
    blocked: 1,
    review: 4,
    oldestWaitingSeconds: 720,
    activeWorkers: 2,
  });
  assert.deepEqual(snapshot.attention, { blocked: 1, review: 4, diagnostics: 3, failedJobs: 1, total: 9 });
  assert.equal(snapshot.jobs[0].name, "Broken sync", "failed jobs should lead the watchlist");
  assert.equal(snapshot.jobs[0].cadence, "Every 15 minutes");
  assert.equal(snapshot.jobs[1].cadence, "Daily");
  assert.equal(snapshot.health.memory, "elevated");
  assert.equal(snapshot.updatedAt, 1_777_777_777_000);
  assert.ok(session.calls.filter((url) => url.includes("board=default")).length >= 3);

  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ["must-not-survive", "private provider failure", "private detail", "9876", "claim_lock", "gateway_rss_mb", "free_mb"]) {
    assert.equal(serialized.includes(forbidden), false, `snapshot leaked ${forbidden}`);
  }
});

test("scheduled-job cadence stays human-readable and timezone-neutral", () => {
  assert.equal(formatScheduleCadence({ kind: "cron", expr: "*/15 * * * *" }), "Every 15 minutes");
  assert.equal(formatScheduleCadence({ kind: "cron", expr: "0 * * * *" }), "Hourly");
  assert.equal(formatScheduleCadence({ kind: "cron", expr: "0 12 * * *" }), "Daily");
  assert.equal(formatScheduleCadence({ kind: "cron", expr: "0 8 * * 1-5" }), "Weekdays");
  assert.equal(formatScheduleCadence({ kind: "cron", expr: "0 8 * * 1-6" }), "Monday–Saturday");
  assert.equal(formatScheduleCadence({ kind: "cron", expr: "0 8 * * 1" }), "Every Monday");
  assert.equal(formatScheduleCadence({ kind: "interval", minutes: 720 }), "Every 12 hours");
  assert.equal(formatScheduleCadence(null, "every 2m"), "Every 2 minutes");
  assert.equal(formatScheduleCadence({ kind: "cron", expr: "0 8 1,15 * *" }), "Custom schedule");
  assert.equal(formatScheduleCadence(null, ""), "Schedule unavailable");
});

test("optional Hermes surfaces degrade independently", async () => {
  const session = sessionFixture({
    jobs: { status: 404, body: { detail: "missing" } },
    queue: { status: 404, body: { detail: "missing" } },
    workers: { status: 404, body: { detail: "missing" } },
    diagnostics: { status: 500, body: { detail: "private" } },
  });
  const snapshot = await new DashboardOperationsClient({ baseUrl: "http://127.0.0.1:9119", session }).load();
  assert.equal(snapshot.state, "partial");
  assert.deepEqual(snapshot.available, { queue: false, jobs: false, health: true, diagnostics: false });
  assert.equal(snapshot.queue, null);
  assert.deepEqual(snapshot.jobs, []);
  assert.equal(snapshot.health.gateway, "ok");
});

test("an expired primary Dashboard session still fails the complete refresh", async () => {
  const expired = Object.assign(new Error("session_expired"), { code: "session_expired", status: 401 });
  const session = sessionFixture();
  session.requestJson = async ({ url }) => {
    if (url.includes("/api/cron/jobs")) throw expired;
    return { status: 404, body: null };
  };
  await assert.rejects(
    new DashboardOperationsClient({ baseUrl: "http://127.0.0.1:9119", session }).load(),
    (error) => error === expired,
  );
});

test("normalizers reject malformed contracts and keep only coarse pressure fields", () => {
  assert.throws(() => normalizeGatewayHealth(null), /status_contract_mismatch/);
  assert.throws(() => normalizeQueueStats({ by_status: [] }), /queue_contract_mismatch/);
  assert.throws(() => normalizeScheduledJobs({ jobs: [] }), /cron_contract_mismatch/);
  assert.deepEqual(normalizeGatewayHealth({ gateway_running: false, memory: { pressure: "critical", private: "drop" }, disk: { pressure: "nonsense" } }), {
    gateway: "degraded",
    memory: "critical",
    disk: "unknown",
  });
});
