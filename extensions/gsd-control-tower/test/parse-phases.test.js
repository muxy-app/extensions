import { test } from "node:test";
import assert from "node:assert/strict";
import { collectPhases, normalizeNumber } from "../src/core/gsd/parse-phases.js";
import { buildGsdSnapshot } from "../src/core/gsd/parse-planning.js";
import { BOUNDS } from "../src/core/types.js";

/**
 * In-memory project mirroring the real unnamed-game shape:
 * phase 01 fully complete (discuss → research → ui → plan 5/5 → execute 5/5
 * → verify passed), phase 02 mid-flight (discussed/researched/UI-specced,
 * 8 plans written, none executed, no verification yet).
 */
function unnamedGameSource() {
  const dirs = new Map([
    [".planning/phases", [
      { name: "01-clean-playable-foundation", isDirectory: true },
      { name: "02-opening-convoy-protection", isDirectory: true },
    ]],
    [".planning/phases/01-clean-playable-foundation", [
      "01-DISCUSSION-LOG.md", "01-CONTEXT.md", "01-RESEARCH.md", "01-UI-SPEC.md",
      "01-PATTERNS.md", "01-REVIEW.md", "01-SECURITY.md", "01-VALIDATION.md",
      "01-01-PLAN.md", "01-01-SUMMARY.md",
      "01-02-PLAN.md", "01-02-SUMMARY.md",
      "01-03-PLAN.md", "01-03-SUMMARY.md",
      "01-04-PLAN.md", "01-04-SUMMARY.md",
      "01-05-PLAN.md", "01-05-SUMMARY.md",
      "01-VERIFICATION.md",
    ].map((name) => ({ name, isDirectory: false }))],
    [".planning/phases/02-opening-convoy-protection", [
      "02-DISCUSSION-LOG.md", "02-CONTEXT.md", "02-RESEARCH.md", "02-UI-SPEC.md",
      "02-01-PLAN.md", "02-02-PLAN.md", "02-03-PLAN.md",
      "02-04-PLAN.md", "02-05-PLAN.md", "02-06-PLAN.md",
      "02-07-PLAN.md", "02-08-PLAN.md",
    ].map((name) => ({ name, isDirectory: false }))],
  ]);
  const files = new Map([
    [".planning/phases/01-clean-playable-foundation/01-VERIFICATION.md",
      "---\nstatus: passed\nscore: 9/9\nverified: 2026-08-20T10:00:00Z\n---\n# V\n"],
    [".planning/ROADMAP.md",
      "# Roadmap\n\n## Phases\n\n" +
      "- [x] **Phase 1: Clean Playable Foundation** - A clean base.\n" +
      "- [ ] **Phase 2: Opening Convoy Protection** - Protect the convoy.\n" +
      "- [ ] **Phase 3: Route Fork** - Fork the routes.\n"],
  ]);
  return {
    async list(path) {
      if (path === ".planning") {
        return [
          { name: "STATE.md", path: "", isDirectory: false },
          { name: "ROADMAP.md", path: "", isDirectory: false },
          { name: "phases", path: "", isDirectory: true },
        ];
      }
      return dirs.get(path) ?? null;
    },
    async read(path) {
      return files.get(path)
        // PLAN/SUMMARY etc. contents are irrelevant to the collector.
        ?? (path.endsWith(".md") && !path.endsWith("VERIFICATION.md") ? "# x\n" : null);
    },
  };
}

test("collectPhases derives per-stage completion from artifacts", async () => {
  const phases = await collectPhases(unnamedGameSource(), { currentPhaseNumber: "02" });
  assert.equal(phases.length, 2);

  const p1 = phases[0];
  assert.equal(p1.number, "1");
  assert.equal(p1.stages.discuss, true);
  assert.equal(p1.stages.research, true);
  assert.equal(p1.stages.ui, true);
  assert.equal(p1.stages.patterns, true);
  assert.equal(p1.stages.review, true);
  assert.equal(p1.stages.security, true);
  assert.equal(p1.stages.validation, true);
  assert.deepEqual([p1.plansTotal, p1.plansDone], [5, 5]);
  assert.equal(p1.verification, "passed");
  assert.match(p1.verificationDetail ?? "", /9\/9/);
  assert.equal(p1.isCurrent, false);

  const p2 = phases[1];
  assert.equal(p2.number, "2");
  assert.equal(p2.isCurrent, true); // STATE says phase 02
  assert.equal(p2.stages.discuss, true);
  assert.equal(p2.stages.ui, true);
  assert.equal(p2.stages.spec, false);
  assert.deepEqual([p2.plansTotal, p2.plansDone], [8, 0]);
  assert.equal(p2.verification, "unknown");
});

test("normalizeNumber strips zero padding per segment", () => {
  assert.equal(normalizeNumber("02"), "2");
  assert.equal(normalizeNumber("02.10"), "2.10");
  assert.equal(normalizeNumber("3"), "3");
  assert.equal(normalizeNumber("weird"), "weird");
});

test("end-to-end: executing snapshot carries concerns, fresh activity, and the pipeline", async () => {
  const source = unnamedGameSource();
  const baseRead = source.read.bind(source);
  const STATE = [
    "---",
    "milestone: v1.0",
    "status: executing",
    'current_phase: "02"',
    'last_updated: "2026-08-22T23:16:40.159Z"',
    "last_activity: 2026-08-22",
    "---",
    "",
    "# Project State",
    "",
    "## Current Position",
    "",
    "Phase: 02 (Opening Convoy Protection) — EXECUTING",
    "Plan: 1 of 8",
    "Status: Executing Phase 02",
    "Last activity: 2026-08-22 — Phase 02 execution started",
    "Progress: [██████████] 100%",
    "",
    "### Blockers/Concerns",
    "",
    "- Native Windows launch validation needs a Windows machine later; producing the build alone is not validation.",
    "",
  ].join("\n");
  source.read = async (path) => (path === ".planning/STATE.md" ? STATE : baseRead(path));
  const { gsd } = await buildGsdSnapshot(source);
  // The decorative 100% bar must not read as complete…
  assert.notEqual(gsd.frontmatterStatus, "complete");
  // …the future-tense concern must not read as blocked…
  assert.ok(Array.isArray(gsd.concerns));
  assert.equal(gsd.concerns.length, 1);
  // …and last_activity's midnight must lose to last_updated's full timestamp.
  assert.equal(gsd.lastActivity, "2026-08-22T23:16:40.159Z");
  assert.equal(gsd.phaseDir, "02-opening-convoy-protection");
  assert.equal(gsd.phases.find((p) => p.number === "3").name, "Route Fork"); // roadmap-only
});

test("phase directory inventory is capped and reports the bound", async () => {
  const entries = Array.from({ length: BOUNDS.maxPhases + 15 }, (_, i) => ({
    name: `${String(i + 1).padStart(3, "0")}-phase`,
    isDirectory: true,
  }));
  const warnings = [];
  const phases = await collectPhases({
    async list(path) { return path === ".planning/phases" ? entries : []; },
    async read() { return null; },
  }, { warnings });
  assert.equal(phases.length, BOUNDS.maxPhases);
  assert.ok(warnings.some((warning) => warning.includes(`to ${BOUNDS.maxPhases}`)));
});
