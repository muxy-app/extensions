#!/usr/bin/env node
// Overwrite the focus-timer state file with plausible demo data for
// marketplace screenshots, so no real usage shows in the report. Run with
// the extension toggled OFF (the live background flushes its own state every
// minute and would clobber this); toggle it back on to hydrate the seed.
//
// Deterministic (seeded PRNG): re-running produces identical data.

import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), "Library", "Application Support", "muxy-focus-timer");
const FILE = join(DIR, "state.json");

let seed = 20260916;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const between = (lo, hi) => lo + rand() * (hi - lo);
const hours = (lo, hi) => Math.round(between(lo, hi) * 3600);

const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ── the demo world ──────────────────────────────────────────────────────────

const P = {
  meridian: "demo-proj-meridian",
  atlas: "demo-proj-atlas",
  docs: "demo-proj-docs",
  tooling: "demo-proj-tooling",
};

const W = {
  meridianMain: "demo-wt-meridian-main",
  meridianPay: "demo-wt-meridian-payments",
  meridianOnb: "demo-wt-meridian-onboarding",
  atlasMain: "demo-wt-atlas-main",
  atlasBatch: "demo-wt-atlas-batch",
  docsMain: "demo-wt-docs-main",
  toolingMain: "demo-wt-tooling-main",
};

const ctx = {
  projects: {
    [P.meridian]: { name: "meridian-app", path: "~/build/meridian-app", iconColor: "#E8823A" },
    [P.atlas]: { name: "atlas-api", path: "~/build/atlas-api", iconColor: "#5B8DEF" },
    [P.docs]: { name: "docs-site", path: "~/build/docs-site", iconColor: "#4CAF7D" },
    [P.tooling]: { name: "release-tooling", path: "~/build/release-tooling", iconColor: "#9B7BD4" },
  },
  worktrees: {
    [W.meridianMain]: { name: "meridian-app", branch: "main", projectID: P.meridian },
    [W.meridianPay]: { name: "feat-payments", branch: "feat/payments", projectID: P.meridian },
    [W.meridianOnb]: { name: "fix-onboarding", branch: "fix/onboarding", projectID: P.meridian },
    [W.atlasMain]: { name: "atlas-api", branch: "main", projectID: P.atlas },
    [W.atlasBatch]: { name: "agent-batch", branch: "agents/batch-42", projectID: P.atlas },
    [W.docsMain]: { name: "docs-site", branch: "main", projectID: P.docs },
    [W.toolingMain]: { name: "release-tooling", branch: "main", projectID: P.tooling },
  },
};

// ── day generation: Mon Aug 24 → today ──────────────────────────────────────

const DEGRADED = new Set(["2026-08-27", "2026-09-04"]);
const days = {};
const pomoLog = [];

const addProject = (day, projectID, you, agent, splits) => {
  if (you <= 0 && agent <= 0) return;
  const p = (day.projects[projectID] ??= { you: 0, agent: 0, pomos: 0 });
  p.you += you;
  p.agent += agent;
  for (const [worktreeID, youShare, agentShare] of splits) {
    const w = (day.worktrees[worktreeID] ??= { you: 0, agent: 0 });
    w.you += Math.round(you * youShare);
    w.agent += Math.round(agent * agentShare);
  }
};

const today = new Date();
for (let d = new Date(2026, 7, 24); d <= today; d.setDate(d.getDate() + 1)) {
  const key = dayKey(d);
  const dow = d.getDay(); // 0 Sun … 6 Sat
  const weekend = dow === 0 || dow === 6;
  const day = { projects: {}, worktrees: {} };

  if (weekend) {
    if (rand() < 0.25) {
      // The occasional weekend hour, one project, light agent use.
      addProject(day, P.docs, hours(0.4, 1.4), hours(0, 0.3), [[W.docsMain, 1, 1]]);
    }
  } else {
    const paySplit = between(0.4, 0.6);
    addProject(day, P.meridian, hours(1.5, 3.2), hours(0.4, 1.5), [
      [W.meridianMain, 1 - paySplit - 0.15, 0.3],
      [W.meridianPay, paySplit, 0.6],
      [W.meridianOnb, 0.15, 0.1],
    ]);
    addProject(day, P.atlas, hours(0.7, 1.8), hours(1.2, 2.8), [
      [W.atlasMain, 0.55, 0.2],
      [W.atlasBatch, 0.45, 0.8],
    ]);
    if (rand() < 0.7) addProject(day, P.docs, hours(0.1, 0.8), hours(0, 0.3), [[W.docsMain, 1, 1]]);
    if (rand() < 0.3) {
      // The agents-run-the-show project: their time dwarfs yours.
      addProject(day, P.tooling, hours(0.2, 0.6), hours(1.5, 3.5), [[W.toolingMain, 1, 1]]);
    }

    // Pomodoros, weighted toward the main project.
    const pomos = 3 + Math.floor(rand() * 6);
    for (let i = 0; i < pomos; i += 1) {
      const projectID = rand() < 0.7 ? P.meridian : P.atlas;
      day.projects[projectID].pomos += 1;
      const startedAt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 20).getTime() + i * 50 * 60_000;
      pomoLog.push({ startedAt, minutes: 25, projectID, completed: true });
    }
    if (rand() < 0.35) {
      // An abandoned session now and then keeps the completion rate honest.
      const startedAt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 16, 40).getTime();
      pomoLog.push({ startedAt, minutes: 25, projectID: P.meridian, completed: false });
    }
  }

  if (DEGRADED.has(key)) day.degraded = true;
  if (Object.keys(day.projects).length) days[key] = day;
}

pomoLog.sort((a, b) => b.startedAt - a.startedAt);

// ── write ───────────────────────────────────────────────────────────────────

const state = {
  v: 1,
  demo: true,
  savedAt: Date.now(),
  onboarded: true,
  // paused: no real usage accrues on top of the demo data while shooting.
  config: { paused: true },
  days,
  ctx,
  pomoLog: pomoLog.slice(0, 200),
  checkpoint: {
    segment: null,
    agentSegments: {},
    // Two dots filled on the pomodoro card, mid-cadence.
    pomo: { phase: "idle", endsAt: null, remainingMs: null, pending: null, cycle: 2, projectID: P.meridian, startedAt: null },
  },
};

mkdirSync(DIR, { recursive: true });
writeFileSync(FILE, JSON.stringify(state, null, 2));

const totals = Object.values(days).reduce(
  (t, day) => {
    for (const p of Object.values(day.projects)) {
      t.you += p.you;
      t.agent += p.agent;
      t.pomos += p.pomos;
    }
    return t;
  },
  { you: 0, agent: 0, pomos: 0 },
);
console.log(`Seeded ${FILE}`);
console.log(
  `${Object.keys(days).length} days · you ${(totals.you / 3600).toFixed(1)}h · agents ${(totals.agent / 3600).toFixed(1)}h · ${totals.pomos} pomos · ${state.pomoLog.length} log entries`,
);
