import assert from "node:assert/strict";
import test from "node:test";

import { requestConfirmedStop } from "../src/stop-confirmation.js";

test("stop confirmation makes keeping the run the explicit safe default", async () => {
  let options = null;
  let stopped = false;
  const result = await requestConfirmedStop({
    confirm: async (value) => {
      options = value;
      return null;
    },
    canStop: () => true,
    stop: async () => { stopped = true; },
  });

  assert.deepEqual(options, {
    title: "Stop this Hermes run?",
    message: "Hermes will cancel the active run. Completed output remains visible.",
    buttons: ["Keep running", "Stop run"],
    default: "Keep running",
    cancel: "Keep running",
    style: "warning",
  });
  assert.equal(result, "cancelled");
  assert.equal(stopped, false);
});

test("stop confirmation converts native bridge rejection into a bounded result", async () => {
  let stopped = false;
  const result = await requestConfirmedStop({
    confirm: async () => { throw new Error("raw native bridge failure"); },
    canStop: () => true,
    stop: async () => { stopped = true; },
  });

  assert.equal(result, "confirmation_failed");
  assert.equal(stopped, false);
});

test("stop confirmation rechecks the active run after the dialog resolves", async () => {
  let active = true;
  let stopped = false;
  const result = await requestConfirmedStop({
    confirm: async () => {
      active = false;
      return "Stop run";
    },
    canStop: () => active,
    stop: async () => { stopped = true; },
  });

  assert.equal(result, "stale");
  assert.equal(stopped, false);
});

test("stop confirmation invokes stop once only after an affirmative current check", async () => {
  let stops = 0;
  const result = await requestConfirmedStop({
    confirm: async () => "Stop run",
    canStop: () => true,
    stop: async () => { stops += 1; },
  });

  assert.equal(result, "stopped");
  assert.equal(stops, 1);
});
