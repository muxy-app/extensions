import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshDue, sanitizePrefs } from "../src/host/prefs.js";

test("prefs sanitization bounds lists and discards retired status settings (NFR-004)", () => {
  const cleaned = sanitizePrefs({
    staleThresholdMinutes: 100000,
    refreshIntervalMinutes: 30,
    showNonGsd: "yes",
    hiddenProjects: ["a", 42, "b".repeat(300)],
    filters: { query: "x".repeat(500), statuses: ["waiting", 7], providers: ["ignored"] },
  });
  assert.equal("staleThresholdMinutes" in cleaned, false);
  assert.equal(cleaned.refreshIntervalMinutes, 30);
  assert.equal(cleaned.showNonGsd, false); // non-boolean falls back to the new default (hidden)
  assert.deepEqual(cleaned.hiddenProjects, ["a"]);
  assert.equal(cleaned.filters.query.length, 200);
  assert.equal("statuses" in cleaned.filters, false);
  assert.equal("providers" in cleaned.filters, false);
});

test("prefs sanitization yields defaults for garbage input", () => {
  const cleaned = sanitizePrefs({ staleThresholdMinutes: "soon" });
  assert.deepEqual(cleaned, {
    refreshIntervalMinutes: 5,
    openOnActiveProject: true,
    showNonGsd: false,
    hiddenProjects: [],
    filters: { query: "" },
  });
});

test("cross-project refresh supports manual or bounded preset intervals", () => {
  const now = Date.parse("2026-08-24T01:00:00Z");
  assert.equal(refreshDue("2026-08-24T00:54:59Z", 5, now), true);
  assert.equal(refreshDue("2026-08-24T00:56:00Z", 5, now), false);
  assert.equal(refreshDue(null, 5, now), true);
  assert.equal(refreshDue("2026-08-23T00:00:00Z", 0, now), false);
  assert.equal(sanitizePrefs({ refreshIntervalMinutes: 7 }).refreshIntervalMinutes, 5);
});
