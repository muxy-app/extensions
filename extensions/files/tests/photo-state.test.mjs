import assert from "node:assert/strict";
import test from "node:test";

import {
  adjust_is_neutral,
  crop_is_full,
  initial_state,
  neutral_adjust,
  state_is_clean,
} from "../src/photo/state.js";

test("a freshly opened image counts as unedited", () => {
  const state = initial_state(1200, 800);
  state.crop = { x: 0, y: 0, width: 1, height: 1 };
  assert.equal(state_is_clean(state, { width: 1200, height: 800 }), true);
});

test("every kind of edit marks the image dirty", () => {
  const base = () => {
    const state = initial_state(1200, 800);
    state.crop = { x: 0, y: 0, width: 1, height: 1 };
    return state;
  };
  const size = { width: 1200, height: 800 };

  const rotated = base();
  rotated.angle = 0.4;
  assert.equal(state_is_clean(rotated, size), false);

  const mirrored = base();
  mirrored.flipH = true;
  assert.equal(state_is_clean(mirrored, size), false);

  const cropped = base();
  cropped.crop = { x: 0.1, y: 0, width: 0.8, height: 1 };
  assert.equal(state_is_clean(cropped, { width: 960, height: 800 }), false);

  const resized = base();
  resized.output.width = 600;
  assert.equal(state_is_clean(resized, size), false);

  const graded = base();
  graded.adjust.contrast = 12;
  assert.equal(state_is_clean(graded, size), false);
});

test("crop_is_full tolerates float drift but not real crops", () => {
  assert.equal(crop_is_full(null), true);
  assert.equal(crop_is_full({ x: 0.0001, y: 0, width: 0.9999, height: 1 }), true);
  assert.equal(crop_is_full({ x: 0, y: 0, width: 0.9, height: 1 }), false);
});

test("neutral adjustments round-trip", () => {
  const adjust = neutral_adjust();
  assert.equal(adjust_is_neutral(adjust), true);
  adjust.grayscale = true;
  assert.equal(adjust_is_neutral(adjust), false);
});
