import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseProjectMd, parseConfigJson, parseHandoffJson, parseContinueHere, parseVerificationMd,
} from "../src/core/gsd/parse-support.js";
import { parseRoadmap, nextOpenPhase } from "../src/core/gsd/parse-roadmap.js";

test("PROJECT.md name + core value", () => {
  const r = parseProjectMd("# alpha\n\n## Core Value\nExercises fixtures.\n\n## Next\nMore");
  assert.equal(r.name, "alpha");
  assert.equal(r.coreValue, "Exercises fixtures.");
});

test("config.json tolerates invalid JSON", () => {
  const ok = parseConfigJson('{"workflow":{"verifier":true}}');
  assert.equal(ok.config.workflow.verifier, true);
  const bad = parseConfigJson("{nope");
  assert.deepEqual(bad.config, {});
  assert.ok(bad.warnings[0].includes("invalid JSON"));
});

test("HANDOFF.json paused shape", () => {
  const paused = parseHandoffJson(JSON.stringify({
    version: "1.0", timestamp: "2026-08-16T14:53:55.081Z",
    phase_name: "strategic-reset-deliberation", task: 4, total_tasks: 6, status: "paused",
  }));
  assert.equal(paused.paused, true);
  assert.equal(paused.task, 4);
  const running = parseHandoffJson(JSON.stringify({ status: "active" }));
  assert.equal(running.paused, false);
  const broken = parseHandoffJson("{bad json");
  assert.equal(broken.paused, false);
  assert.ok(broken.warnings.length > 0);
});

test(".continue-here.md frontmatter shape", () => {
  const text = `---
context: phase
phase: 00-authentication-feasibility-gate
task: 3
total_tasks: 3
status: paused
last_updated: 2026-08-17T14:20:29.787Z
---

# BLOCKING CONSTRAINTS
`;
  const r = parseContinueHere(text);
  assert.equal(r.paused, true);
  assert.equal(r.phase, "00-authentication-feasibility-gate");
  assert.equal(r.totalTasks, 3);
});

test("verification statuses normalize incl. body-line fallback", () => {
  const passed = parseVerificationMd("---\nstatus: passed\nverified: 2026-08-15T22:25:00Z\nscore: 2/2\n---\n# V\n");
  assert.equal(passed.status, "passed");
  const failBody = parseVerificationMd("# Report\n**Status:** failed\n");
  assert.equal(failBody.status, "failed");
  const unknown = parseVerificationMd("# Nothing here\n");
  assert.equal(unknown.status, "unknown");
  assert.ok(unknown.warnings.length > 0);
});

const ROADMAP = `# Roadmap: demo

## Phases

- [x] **Phase 1: Inventory Foundation** - List projects and worktrees.
- [x] **Phase 2: Parser Core** - Parse artifacts tolerantly.
- [ ] **Phase 2.1: Urgent Fixture Fix** - Repair the decimal-phase gap.
- [ ] **Phase 3: Status Queue Polish** - Make waiting state clear.
- [ ] **Phase 4: Ship** - Validate and document.

## Phase Details

### Phase 3: Status Queue Polish
**Goal:** Show waiting and failed-verification states with clear reasons.

### Phase 9: Detail-only phase
**Goal:** Present only in details.
`;

test("roadmap checklist parses integer + decimal phases", () => {
  const r = parseRoadmap(ROADMAP);
  assert.equal(r.phases.length, 5); // detail-only Phase 9 has no goal match? see below
  assert.deepEqual(r.phases.map((p) => p.number), ["1", "2", "2.1", "3", "4"]);
  const p3 = r.phases.find((p) => p.number === "3");
  assert.equal(p3.done, false);
  assert.match(p3.goal ?? "", /Make waiting/);
});

test("nextOpenPhase returns first not-done in numeric order (decimal after int)", () => {
  const r = parseRoadmap(ROADMAP);
  const next = nextOpenPhase(r.phases);
  assert.equal(next?.number, "2.1");
});
