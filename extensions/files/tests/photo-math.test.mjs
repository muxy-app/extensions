import assert from "node:assert/strict";
import test from "node:test";

import {
  build_tone_luts,
  clamp_rect,
  copy_path_candidate,
  fit_aspect,
  inscribed_size,
  normalize_angle,
  replace_ext,
  resize_dims,
  rotated_size,
  scale_dims,
} from "../src/lib/photo-math.js";

test("angles wrap into (-180, 180]", () => {
  assert.equal(normalize_angle(0), 0);
  assert.equal(normalize_angle(360), 0);
  assert.equal(normalize_angle(190), -170);
  assert.equal(normalize_angle(-190), 170);
  assert.equal(normalize_angle(180), 180);
  assert.equal(normalize_angle(0.5), 0.5);
});

test("a quarter turn swaps the bounding box", () => {
  const size = rotated_size(400, 200, 90);
  assert.equal(Math.round(size.width), 200);
  assert.equal(Math.round(size.height), 400);
});

test("an arbitrary angle grows the bounding box", () => {
  const size = rotated_size(100, 100, 45);
  assert.ok(size.width > 141 && size.width < 142);
  assert.ok(size.height > 141 && size.height < 142);
});

test("trimming a square tilted 45 degrees keeps the inscribed square", () => {
  const inside = inscribed_size(100, 100, 45);
  assert.ok(Math.abs(inside.width - 100 / Math.SQRT2) < 0.001);
  assert.ok(Math.abs(inside.height - 100 / Math.SQRT2) < 0.001);
});

test("trimming is a no-op at 0 and a swap at 90 degrees", () => {
  assert.deepEqual(inscribed_size(300, 200, 0), { width: 300, height: 200 });
  assert.deepEqual(inscribed_size(300, 200, 90), { width: 200, height: 300 });
});

test("a trimmed rectangle always fits the rotated bounds", () => {
  for (const angle of [3, 12.5, 33, 47, 61, 89]) {
    const bounds = rotated_size(1600, 900, angle);
    const inside = inscribed_size(1600, 900, angle);
    assert.ok(inside.width <= bounds.width + 1e-6, `width at ${angle}`);
    assert.ok(inside.height <= bounds.height + 1e-6, `height at ${angle}`);
    assert.ok(inside.width > 0 && inside.height > 0, `positive at ${angle}`);
  }
});

test("crop rectangles stay inside their bounds", () => {
  const rect = clamp_rect({ x: -5, y: 40, width: 120, height: 50 }, { width: 100, height: 60 });
  assert.deepEqual(rect, { x: 0, y: 10, width: 100, height: 50 });
});

test("aspect ratios shrink the crop and keep it centred", () => {
  const rect = fit_aspect({ x: 0, y: 0, width: 100, height: 100 }, 1, { width: 100, height: 100 });
  assert.deepEqual(rect, { x: 0, y: 0, width: 100, height: 100 });

  const wide = fit_aspect({ x: 0, y: 0, width: 100, height: 100 }, 2, { width: 100, height: 100 });
  assert.equal(wide.width, 100);
  assert.equal(wide.height, 50);
  assert.equal(wide.y, 25);
});

test("the aspect lock follows whichever dimension was typed", () => {
  const byWidth = resize_dims({
    width: 800,
    height: 600,
    sourceWidth: 1600,
    sourceHeight: 1200,
    lock: true,
    edited: "width",
  });
  assert.deepEqual(byWidth, { width: 800, height: 600 });

  const byHeight = resize_dims({
    width: 800,
    height: 300,
    sourceWidth: 1600,
    sourceHeight: 1200,
    lock: true,
    edited: "height",
  });
  assert.deepEqual(byHeight, { width: 400, height: 300 });

  const free = resize_dims({
    width: 999,
    height: 111,
    sourceWidth: 1600,
    sourceHeight: 1200,
    lock: false,
    edited: "width",
  });
  assert.deepEqual(free, { width: 999, height: 111 });
});

test("percentage scaling rounds to whole pixels", () => {
  assert.deepEqual(scale_dims(1000, 667, 50), { width: 500, height: 334 });
  assert.deepEqual(scale_dims(10, 10, 1), { width: 1, height: 1 });
});

test("neutral adjustments produce an identity tone curve", () => {
  const luts = build_tone_luts({ exposure: 0, brightness: 0, contrast: 0, gamma: 1, temperature: 0, tint: 0 });
  for (const value of [0, 1, 64, 127, 200, 255]) {
    assert.equal(luts.r[value], value);
    assert.equal(luts.g[value], value);
    assert.equal(luts.b[value], value);
  }
});

test("warming the image lifts red and drops blue", () => {
  const luts = build_tone_luts({ temperature: 50 });
  assert.ok(luts.r[128] > 128);
  assert.ok(luts.b[128] < 128);
});

test("copies get a suffixed name and honour the export format", () => {
  assert.equal(copy_path_candidate("photos/cat.png", ".png"), "photos/cat-edited.png");
  assert.equal(copy_path_candidate("photos/cat.png", ".jpg", 3), "photos/cat-edited-3.jpg");
  assert.equal(copy_path_candidate("cat.jpeg", ".webp"), "cat-edited.webp");
  assert.equal(replace_ext("photos/cat.png", ".jpg"), "photos/cat.jpg");
});
