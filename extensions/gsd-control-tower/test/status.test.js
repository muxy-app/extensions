import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStatus, isComplete, latestChangeMs, compareAttention } from "../src/core/status.js";
import { CONTROL_PRIORITY } from "../src/core/types.js";
import { minutesAgo } from "./helpers.js";

const baseGsd = {
  recognized: true,
  blockers: [],
  verification: "unknown",
  paused: false,
  progress: { percent: 40 },
  frontmatterStatus: "active",
  statusLine: "In progress",
  lastActivity: minutesAgo(5),
  evidence: [{ path: ".planning/STATE.md", observedAt: minutesAgo(5) }],
  errors: [],
};

test("waiting comes only from explicit runtime report (never inferred)", () => {
  const r = deriveStatus({ isGsd: true, gsd: { ...baseGsd }, agent: { runtimeState: "idle" } });
  assert.notEqual(r.controlState, "waiting");
  const w = deriveStatus({ isGsd: true, gsd: { ...baseGsd }, agent: { runtimeState: "waiting", providerId: "codex" } });
  assert.equal(w.controlState, "waiting");
  assert.match(w.attentionReason ?? "", /Codex/i);
});

test("blocked from STATE.md blockers", () => {
  const gsd = { ...baseGsd, blockers: ["Owner gate failed"] };
  const r = deriveStatus({ isGsd: true, gsd, agent: { runtimeState: "idle" } });
  assert.equal(r.controlState, "blocked");
  assert.match(r.attentionReason ?? "", /STATE\.md/);
});

test("blocked from failed verification cites the phase", () => {
  const gsd = { ...baseGsd, verification: "failed", phaseLabel: "3 of 4 — Polish" };
  const r = deriveStatus({ isGsd: true, gsd, agent: { runtimeState: "working" } });
  // blocked outranks working per PRD priority
  assert.equal(r.controlState, "blocked");
});

test("concerns never block on their own (real-world Blockers/Concerns notes)", () => {
  // unnamed-game case: executing project whose STATE.md holds a deferred,
  // future-tense note under "Blockers/Concerns".
  const gsd = {
    ...baseGsd,
    blockers: [], // parser only fills these when status explicitly says blocked
    concerns: ["Native Windows launch validation needs a Windows machine later"],
  };
  const r = deriveStatus({ isGsd: true, gsd, agent: { runtimeState: "unavailable" } });
  assert.notEqual(r.controlState, "blocked");
});

test("mid-flight workflow suppresses ready even with a recorded next action", () => {
  const gsd = {
    ...baseGsd,
    frontmatterStatus: "executing",
    statusLine: "Executing Phase 02",
    nextAction: "Execute remaining plans in Phase 02",
  };
  const r = deriveStatus({ isGsd: true, gsd, agent: { runtimeState: "unavailable" } });
  assert.notEqual(r.controlState, "ready");
});

test("unknown when recognized but artifacts unreadable", () => {
  const gsd = { ...baseGsd, errors: [".planning/STATE.md is missing — workflow position unknown"] };
  const r = deriveStatus({ isGsd: true, gsd, agent: { runtimeState: "unavailable" } });
  assert.equal(r.controlState, "unknown");
});

test("stale after threshold with no agent activity; not stale while working", () => {
  const oldGsd = { ...baseGsd, lastActivity: minutesAgo(90), evidence: [{ path: ".planning/STATE.md", observedAt: minutesAgo(90) }] };
  const opts = { now: Date.now(), staleThresholdMs: 45 * 60_000 };
  const stale = deriveStatus({ isGsd: true, gsd: oldGsd, agent: { runtimeState: "idle" } }, opts);
  assert.equal(stale.controlState, "stale");
  assert.match(stale.attentionReason ?? "", /No observed change for/);

  const fresh = deriveStatus(
    { isGsd: true, gsd: { ...baseGsd }, agent: { runtimeState: "idle" } },
    { now: Date.now(), staleThresholdMs: 45 * 60_000 });
  assert.notEqual(fresh.controlState, "stale");
});

test("ready requires an explicit next action and no active agent", () => {
  const gsd = { ...baseGsd, nextAction: "Start Phase 3: Attention Queue Polish" };
  const ready = deriveStatus({ isGsd: true, gsd, agent: { runtimeState: "idle" } });
  assert.equal(ready.controlState, "ready");
  assert.match(ready.attentionReason ?? "", /Next action:/);

  const working = deriveStatus({ isGsd: true, gsd, agent: { runtimeState: "working" } });
  // An actively-working agent defers "ready"; runtime state wins.
  assert.equal(working.controlState, "working");
});

test("complete projects fall to idle unless blocked/waiting", () => {
  const gsd = { ...baseGsd, frontmatterStatus: "complete", progress: { percent: 100 } };
  const r = deriveStatus({ isGsd: true, gsd, agent: { runtimeState: "idle" } });
  assert.equal(r.controlState, "idle");
});

test("non-GSD workstream stays idle-neutral with no fabricated reason", () => {
  const r = deriveStatus({ isGsd: false, agent: { runtimeState: "unavailable" } });
  assert.equal(r.controlState, "idle");
  assert.equal(r.attentionReason, undefined);
});

test("priority order matches PRD §3.4", () => {
  assert.deepEqual(Object.keys(CONTROL_PRIORITY), ["waiting", "blocked", "unknown", "stale", "ready", "working", "idle"]);
});

test("compareAttention sorts waiting above blocked above idle regardless of names", () => {
  const mk = (name, controlState) => ({ projectName: name, controlState, refreshedAt: new Date().toISOString(), gsd: {} });
  const sorted = [mk("zzz-idle", "idle"), mk("bbb-blocked", "blocked"), mk("aaa-waiting", "waiting")].sort(compareAttention);
  assert.deepEqual(sorted.map((r) => r.controlState), ["waiting", "blocked", "idle"]);
});

test("isComplete requires explicit status claims — decorative 100% bars don't count", () => {
  assert.equal(isComplete({ recognized: true, frontmatterStatus: "complete" }), true);
  assert.equal(isComplete({ recognized: true, frontmatterStatus: "done" }), true);
  assert.equal(isComplete({ recognized: true, statusLine: "Complete — done" }), true);
  // Real-world case (unnamed-game): executing project whose progress bar renders 100%.
  assert.equal(
    isComplete({ recognized: true, frontmatterStatus: "executing", progress: { percent: 100 } }),
    false,
  );
  assert.equal(isComplete({ recognized: true, frontmatterStatus: "active", progress: { percent: 100 } }), false);
  assert.equal(isComplete(undefined), false);
});

test("latestChangeMs takes newest artifact/git evidence", () => {
  const ms = latestChangeMs(
    { lastActivity: minutesAgo(30), evidence: [{ path: "x", observedAt: minutesAgo(10) }] },
    { lastCommitAt: minutesAgo(60) });
  assert.ok(ms <= Date.now() - 9 * 60_000 && ms >= Date.now() - 11 * 60_000);
  assert.equal(latestChangeMs(undefined, undefined), null);
});

test("latestChangeMs ignores undated evidence (read-time stamps, not change times)", () => {
  const ms = latestChangeMs(
    { lastActivity: minutesAgo(90), evidence: [{ path: "ROADMAP.md", observedAt: new Date().toISOString(), dated: false }] },
    undefined);
  assert.ok(ms <= Date.now() - 89 * 60_000);
});
