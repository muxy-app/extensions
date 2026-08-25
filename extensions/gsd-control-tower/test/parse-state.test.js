import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStateMd, extractSection, parseConcernNotes, normalizeDateish } from "../src/core/gsd/parse-state.js";
import { BOUNDS } from "../src/core/types.js";

const ACTIVE = `---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Marketplace Beta Hardening
status: active
last_updated: "2026-08-22T19:41:28.892Z"
last_activity: 2026-08-22
progress:
  total_phases: 7
  completed_phases: 3
  total_plans: 6
  completed_plans: 6
  percent: 75
---

# Project State

## Current Position

Phase: 7 of 7 — Marketplace Submission
Plan: Not started
Status: Ready — Phase 6 passed the revised support matrix
Last activity: 2026-08-22 — Completed quick task

## Accumulated Context

### Blockers/Concerns

None.

## Session Continuity
`;

const COMPLETE_WITH_BLOCKERS = `---
gsd_state_version: '1.0'
status: complete
progress:
  total_phases: 3
  completed_phases: 3
  percent: 100
---

## Current Position

Phase: 3 of 3 complete (Owner Review and Terminal Decision)
Plan: 2 of 2 queue gates complete
Status: Complete — bounded outcome recorded
Last activity: 2026-08-15 — owner gate failed.

Progress: [██████████] 100%

### Blockers/Concerns

- Owner readability gate failed; no product pass.
- The candidate is retired.
`;

const BLOCKED_STATE = `---
status: blocked on review
---

## Current Position

Phase: 2 of 4 — Review
Status: Blocked on external review

### Blockers/Concerns

- Waiting on API credentials from the platform team.
- Windows validation still needs a runner later.
`;

test("parses the active/milestone STATE.md shape", () => {
  const r = parseStateMd(ACTIVE);
  assert.equal(r.frontmatter.milestone, "v1.1");
  assert.equal(r.frontmatter.milestone_name, "Marketplace Beta Hardening");
  assert.equal(r.phaseLabel, "7 of 7 — Marketplace Submission");
  assert.equal(r.phaseNumber, "7");
  assert.equal(r.planLabel, "Not started");
  assert.match(r.statusLine ?? "", /^Ready/);
  // Freshest timestamp wins: full ISO last_updated beats the date-only body line.
  assert.equal(r.lastActivity, "2026-08-22T19:41:28.892Z");
  assert.equal(r.lastActivityDesc, "Completed quick task");
  assert.deepEqual(r.concerns, []);
  assert.equal(r.progress.total_phases, 7);
  assert.equal(r.percent, 75);
});

test("parses complete state with planning notes and progress-bar fallback", () => {
  const r = parseStateMd(COMPLETE_WITH_BLOCKERS);
  assert.equal(r.frontmatter.status, "complete");
  assert.equal(r.phaseNumber, "3");
  assert.equal(r.phaseName, "Owner Review and Terminal Decision");
  assert.equal(r.percent, 100); // frontmatter wins; bar agrees
  // Status says complete → these bullets are concerns, not active blockers.
  assert.equal(r.concerns.length, 2);
  assert.match(r.concerns[0], /readability gate failed/);
});

test("status prose never promotes Blockers/Concerns notes into criticality", () => {
  const r = parseStateMd(BLOCKED_STATE);
  assert.equal(r.concerns.length, 2);
  assert.match(r.concerns[0], /waiting on API credentials/i);
});

test("all raw status text is display-only", () => {
  for (const status of ["Blocked", "Not blocked", "Ready — blocking work completed", "Active with blocked tasks resolved"]) {
    const parsed = parseStateMd(`---\nstatus: active\n---\n\n## Current Position\n\nStatus: ${status}\n\n### Blockers/Concerns\n\n- Historical note only\n`);
    assert.deepEqual(parsed.concerns, ["Historical note only"], status);
    assert.equal(parsed.statusLine, status);
  }
});

test("missing frontmatter and position section produce warnings, not throws", () => {
  const r = parseStateMd("# Nothing useful\n", ".planning/STATE.md");
  assert.ok(r.warnings.some((w) => w.includes("frontmatter")));
  assert.ok(r.warnings.some((w) => w.includes("Current Position")));
  assert.equal(r.phaseLabel, undefined);
});

test("extractSection stops at same-or-higher headings", () => {
  const md = "# T\n## A\ncontent-a\n### Sub\nsub-content\n## B\ncontent-b\n";
  const a = extractSection(md, "## A");
  assert.match(a, /content-a/);
  assert.match(a, /sub-content/);
  assert.doesNotMatch(a, /content-b/);
});

test("parseConcernNotes skips None variants and accepts bullet styles", () => {
  const section = "- None.\n- Real blocker one\n* Real blocker two\n1. Numbered blocker\nplain line\n";
  const notes = parseConcernNotes(section);
  assert.deepEqual(notes, [
    "Real blocker one",
    "Real blocker two",
    "Numbered blocker",
  ]);
});

test("normalizeDateish handles ISO and bare dates, rejects prose", () => {
  assert.equal(normalizeDateish("2026-08-15"), "2026-08-15T00:00:00.000Z");
  assert.equal(normalizeDateish("2026-08-22T19:41:28.892Z"), "2026-08-22T19:41:28.892Z");
  assert.equal(normalizeDateish("2026-08-15 — owner gate failed"), "2026-08-15T00:00:00.000Z");
  assert.equal(normalizeDateish("not a date"), undefined);
  assert.equal(normalizeDateish(""), undefined);
});

test("newer current_phase / current_phase_name frontmatter keys fill gaps", () => {
  const r = parseStateMd(`---
status: executing
current_phase: "02"
current_phase_name: Opening Convoy Protection
---

## Current Position

Plan: 1 of 8
`);
  assert.equal(r.phaseNumber, "02");
  assert.equal(r.phaseName, "Opening Convoy Protection");
  assert.equal(r.planLabel, "1 of 8");
});

test("large artifacts and excessive prose notes stay bounded", () => {
  const bullets = Array.from({ length: BOUNDS.maxNotes + 30 }, (_, i) => `- note ${i}`).join("\n");
  const text = `---\nstatus: blocked\n---\n\n## Current Position\n\nStatus: Blocked\n\n### Blockers/Concerns\n\n${bullets}\n${"x".repeat(BOUNDS.maxArtifactChars)}`;
  const parsed = parseStateMd(text);
  assert.equal(parsed.concerns.length, BOUNDS.maxNotes);
  assert.ok(parsed.warnings.some((warning) => warning.includes("truncated")));
});
