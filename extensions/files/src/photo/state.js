// Edit state for the photo editor. The crop rectangle is normalized (0..1) to
// the mirrored + rotated image, so it keeps its place while the user carries on
// straightening and never has to be re-derived when the stage bounds change.

export const ADJUST_KEYS = [
  "exposure",
  "brightness",
  "contrast",
  "gamma",
  "saturation",
  "vibrance",
  "temperature",
  "tint",
  "hue",
  "sharpen",
];

export const NEUTRAL_ADJUST = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  gamma: 1,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  sharpen: 0,
  grayscale: false,
  invert: false,
};

export function neutral_adjust() {
  return { ...NEUTRAL_ADJUST };
}

export function initial_state(width, height) {
  return {
    angle: 0,
    flipH: false,
    flipV: false,
    crop: null, // null == the whole (rotated) image
    aspect: null,
    output: { width, height, lock: true, custom: false },
    adjust: neutral_adjust(),
  };
}

export function adjust_is_neutral(adjust) {
  for (const key of ADJUST_KEYS) {
    if (adjust[key] !== NEUTRAL_ADJUST[key]) return false;
  }
  return adjust.grayscale === false && adjust.invert === false;
}

export function crop_is_full(crop) {
  if (!crop) return true;
  const epsilon = 0.001;
  return (
    Math.abs(crop.x) < epsilon &&
    Math.abs(crop.y) < epsilon &&
    Math.abs(crop.width - 1) < epsilon &&
    Math.abs(crop.height - 1) < epsilon
  );
}

export function state_is_clean(state, cropSize) {
  if (state.angle !== 0 || state.flipH || state.flipV) return false;
  if (!crop_is_full(state.crop)) return false;
  if (!adjust_is_neutral(state.adjust)) return false;
  return (
    Math.round(state.output.width) === Math.round(cropSize.width) &&
    Math.round(state.output.height) === Math.round(cropSize.height)
  );
}
