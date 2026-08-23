import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizePrefs } from "../src/host/prefs.js";
import { planNavigation } from "../src/core/navigation.js";

test("prefs sanitization clamps thresholds and bounded lists (NFR-004)", () => {
  const cleaned = sanitizePrefs({
    staleThresholdMinutes: 100000,
    showNonGsd: "yes",
    hiddenProjects: ["a", 42, "b".repeat(300)],
    filters: { query: "x".repeat(500), statuses: ["waiting", 7], providers: ["claude"] },
  });
  assert.equal(cleaned.staleThresholdMinutes, 1440);
  assert.equal(cleaned.showNonGsd, false); // non-boolean falls back to the new default (hidden)
  assert.deepEqual(cleaned.hiddenProjects, ["a"]);
  assert.equal(cleaned.filters.query.length, 200);
  assert.deepEqual(cleaned.filters.statuses, ["waiting"]);
  assert.deepEqual(cleaned.filters.providers, ["claude"]);
});

test("prefs sanitization yields defaults for garbage input", () => {
  const cleaned = sanitizePrefs({ staleThresholdMinutes: "soon" });
  assert.deepEqual(cleaned, {
    staleThresholdMinutes: 45,
    openOnActiveProject: true,
    showNonGsd: false,
    hiddenProjects: [],
    filters: { query: "", statuses: [], providers: [] },
  });
});

test("navigation plan: inactive project + inactive worktree needs two switches", () => {
  const plan = planNavigation(
    { projectId: "p1", worktreeId: "w2", isActiveWorktree: false },
    { id: "p1", isActive: false },
  );
  assert.deepEqual(plan.steps.map((s) => s.kind), ["switchProject", "switchWorktree"]);
});

test("navigation plan: active project with active workstream is a no-op note", () => {
  const plan = planNavigation(
    { projectId: "p1", worktreeId: null, isActiveWorktree: true },
    { id: "p1", isActive: true },
  );
  assert.deepEqual(plan.steps, []);
  assert.match(plan.note ?? "", /Already the active context/);
});

test("navigation plan: project-only switch explains landing on active worktree (FR-052)", () => {
  const plan = planNavigation(
    { projectId: "p2", worktreeId: null, isActiveWorktree: false },
    { id: "p2", isActive: false },
  );
  assert.deepEqual(plan.steps.map((s) => s.kind), ["switchProject"]);
});
