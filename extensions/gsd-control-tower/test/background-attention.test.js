import { test } from "node:test";
import assert from "node:assert/strict";
import { createAttentionTracker } from "../src/background/attention-tracker.js";

test("restart remains neutral until a fresh panel snapshot", () => {
  const tracker = createAttentionTracker();
  assert.equal(tracker.count(), 0);
  assert.equal(tracker.observeAgent({ worktreeID: "w1", status: "waiting" }), false);
  assert.equal(tracker.count(), 0);
});

test("snapshot synchronizes the waiting baseline before later deltas", () => {
  const tracker = createAttentionTracker();
  assert.equal(tracker.observeSnapshot({ attentionCount: 3, waitingIds: ["w1", "w2"] }), true);
  assert.equal(tracker.count(), 3);
  tracker.observeAgent({ worktreeID: "w1", status: "idle" });
  assert.equal(tracker.count(), 2);
  tracker.observeAgent({ worktreeID: "w3", status: "waiting" });
  assert.equal(tracker.count(), 3);
});

test("a later snapshot replaces hidden-panel deltas with a fresh baseline", () => {
  const tracker = createAttentionTracker();
  tracker.observeSnapshot({ attentionCount: 1, waitingIds: [] });
  tracker.observeAgent({ worktreeID: "w1", status: "waiting" });
  assert.equal(tracker.count(), 2);
  tracker.observeSnapshot({ attentionCount: 4, waitingIds: ["w9"] });
  assert.equal(tracker.count(), 4);
  tracker.observeAgent({ worktreeID: "w9", status: "idle" });
  assert.equal(tracker.count(), 3);
});

test("malformed events and snapshots cannot corrupt the count", () => {
  const tracker = createAttentionTracker();
  assert.equal(tracker.observeSnapshot({ attentionCount: -1, waitingIds: [] }), false);
  assert.equal(tracker.observeSnapshot({ attentionCount: "unknown" }), false);
  assert.equal(tracker.count(), 0);
  tracker.observeSnapshot({ attentionCount: 1, waitingIds: ["w1", null, ""] });
  tracker.observeAgent(null);
  tracker.observeAgent({ worktreeID: "", status: "waiting" });
  tracker.observeAgent({ worktreeID: "w1", status: { unexpected: true } });
  assert.equal(tracker.count(), 1);
});
