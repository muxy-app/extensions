import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGsdSnapshot } from "../src/core/gsd/parse-planning.js";
import { fsSource, FIXTURES } from "./helpers.js";
import { join } from "node:path";

test("alpha-active: full snapshot with phase dir, queue, and explicit next action", async () => {
  const { recognized, gsd } = await buildGsdSnapshot(fsSource(join(FIXTURES, "alpha-active")));
  assert.equal(recognized, true);
  assert.equal(gsd.projectName, "alpha-active");
  assert.equal(gsd.coreValue, "Exercises the active mid-phase artifact shape.");
  assert.equal(gsd.milestone, "v1.1");
  assert.equal(gsd.milestoneName, "Marketplace Beta Hardening");
  assert.equal(gsd.phaseNumber, "3");
  assert.equal(gsd.phaseDir, "03-status-queue-polish");
  assert.deepEqual(gsd.phaseQueue, { plansTotal: 1, plansSummarized: 0 });
  assert.equal(gsd.verification, "unknown"); // phase 3 has no verification file yet
  assert.equal(gsd.paused, false);
  assert.match(gsd.nextAction ?? "", /Execute remaining plan/);
  assert.ok(gsd.evidence.some((e) => e.path === ".planning/STATE.md"));
  assert.ok(gsd.roadmapPhases.some((p) => p.number === "2.1"));
});

test("alpha-active: phase pipeline merges dirs with roadmap and flags the current phase", async () => {
  const { gsd } = await buildGsdSnapshot(fsSource(join(FIXTURES, "alpha-active")));
  const nums = (gsd.phases ?? []).map((p) => p.number);
  // Roadmap-only phases (1, 2.1, 4) appear alongside dir-backed ones (2, 3).
  assert.deepEqual(nums, ["1", "2", "2.1", "3", "4"]);
  const ph2 = gsd.phases.find((p) => p.number === "2");
  assert.equal(ph2.name, "Parser Core");
  assert.equal(ph2.done, true);
  assert.equal(ph2.verification, "passed");
  assert.match(ph2.verificationDetail ?? "", /6\/6/);
  const ph3 = gsd.phases.find((p) => p.number === "3");
  assert.equal(ph3.isCurrent, true);
  assert.equal(ph3.plansTotal, 1);
  assert.equal(ph3.plansDone, 0);
  assert.equal(ph3.done, false);
  assert.equal(gsd.phases.find((p) => p.number === "4").dir, "");
});

test("beta-complete: raw complete status is display-only and prose remains notes", async () => {
  const { recognized, gsd } = await buildGsdSnapshot(fsSource(join(FIXTURES, "beta-complete")));
  assert.equal(recognized, true);
  assert.equal(gsd.frontmatterStatus, "complete");
  assert.equal(gsd.concerns.length, 2);
  assert.equal(gsd.nextAction, undefined);
});

test("gamma-broken: .planning present without STATE.md → recognized but errors recorded", async () => {
  const { recognized, gsd } = await buildGsdSnapshot(fsSource(join(FIXTURES, "gamma-broken")));
  assert.equal(recognized, true);
  assert.ok(gsd.errors.some((e) => e.includes("STATE.md is missing")));
  assert.equal(gsd.phaseLabel, undefined);
});

test("no .planning directory → not recognized", async () => {
  const emptySource = { read: async () => null, list: async () => null };
  const { recognized } = await buildGsdSnapshot(emptySource);
  assert.equal(recognized, false);
});

test("paused continue-here at root drives nextAction", async () => {
  // Build a tiny in-memory project.
  const files = new Map([
    [".planning/STATE.md", "---\nstatus: active\n---\n\n## Current Position\n\nPhase: 2 of 5 — Mid\nPlan: 1 of 3 in flight\nStatus: In progress\n"],
    [".planning/.continue-here.md", "---\nstatus: paused\ntask: 2\ntotal_tasks: 4\nphase: 02-mid\n---\n"],
  ]);
  const source = {
    async read(path) { return files.get(path) ?? null; },
    async list(path) {
      if (path === ".planning") {
        return [...files.keys()]
          .filter((p) => p.startsWith(".planning/") && !p.slice(10).includes("/"))
          .map((p) => ({ name: p.slice(10), path: p, isDirectory: false }));
      }
      return null;
    },
  };
  const { gsd } = await buildGsdSnapshot(source);
  assert.equal(gsd.paused, true);
  assert.match(gsd.nextAction ?? "", /Resume paused work \(task 2 of 4\)/);
});

test("failed verification becomes the recorded next action before plan execution", async () => {
  const files = new Map([
    [".planning/STATE.md", "---\nstatus: active\n---\n\n## Current Position\n\nPhase: 1 of 2 — Core\n"],
    [".planning/phases/01-core/01-01-PLAN.md", "# Plan\n"],
    [".planning/phases/01-core/01-VERIFICATION.md", "---\nstatus: failed\nscore: 1/3\n---\n# V\n"],
  ]);
  const source = {
    async read(path) { return files.get(path) ?? null; },
    async list(path) {
      if (path === ".planning") {
        return [
          { name: "STATE.md", path: "", isDirectory: false },
          { name: "phases", path: "", isDirectory: true },
        ];
      }
      if (path === ".planning/phases") {
        return [{ name: "01-core", path: "", isDirectory: true }];
      }
      if (path === ".planning/phases/01-core") {
        return [
          { name: "01-01-PLAN.md", path: "", isDirectory: false },
          { name: "01-VERIFICATION.md", path: "", isDirectory: false },
        ];
      }
      return null;
    },
  };
  const { gsd } = await buildGsdSnapshot(source);
  assert.equal(gsd.verification, "failed");
  assert.match(gsd.nextAction ?? "", /failed verification/i);
});
