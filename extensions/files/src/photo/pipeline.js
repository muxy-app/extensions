import { DEG, clamp, normalize_angle, rotated_size } from "@/lib/photo-math";
import { apply_adjustments, apply_sharpen } from "@/photo/adjust";

export function make_canvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context_of(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

// Bounds of the mirrored + rotated image, in source pixels.
export function stage_size(width, height, angle) {
  const size = rotated_size(width, height, angle);
  return { width: Math.max(1, Math.round(size.width)), height: Math.max(1, Math.round(size.height)) };
}

// Mirror + rotate. Everything downstream (crop, resize) works on this canvas,
// which is why an arbitrary angle costs no more than a quarter turn.
export function draw_stage(source, state) {
  const width = source.width ?? source.naturalWidth;
  const height = source.height ?? source.naturalHeight;
  const angle = normalize_angle(state.angle);
  const bounds = stage_size(width, height, angle);
  const canvas = make_canvas(bounds.width, bounds.height);
  const ctx = context_of(canvas);

  ctx.translate(bounds.width / 2, bounds.height / 2);
  ctx.rotate(angle * DEG);
  ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
  ctx.drawImage(source, -width / 2, -height / 2, width, height);
  return canvas;
}

// Normalized crop (0..1 of the stage) -> stage pixels.
export function crop_rect_px(crop, bounds) {
  if (!crop) return { x: 0, y: 0, width: bounds.width, height: bounds.height };
  const width = Math.max(1, Math.round(clamp(crop.width, 0, 1) * bounds.width));
  const height = Math.max(1, Math.round(clamp(crop.height, 0, 1) * bounds.height));
  return {
    x: Math.round(clamp(crop.x, 0, 1) * bounds.width),
    y: Math.round(clamp(crop.y, 0, 1) * bounds.height),
    width,
    height,
  };
}

// Downscale in halving steps so large reductions stay smooth instead of aliasing.
function step_down(source, targetWidth, targetHeight) {
  let current = source;
  let width = current.width;
  let height = current.height;
  while (width / 2 >= targetWidth && height / 2 >= targetHeight && width > 2 && height > 2) {
    width = Math.max(targetWidth, Math.floor(width / 2));
    height = Math.max(targetHeight, Math.floor(height / 2));
    const next = make_canvas(width, height);
    context_of(next).drawImage(current, 0, 0, width, height);
    current = next;
  }
  return current;
}

/**
 * Full render: mirror -> rotate -> crop -> resize -> colour.
 *
 * `scale` renders a proportionally smaller copy for the live preview; the same
 * function at scale 1 produces the bytes that get written to disk.
 */
export function render(source, state, opts = {}) {
  const scale = opts.scale ?? 1;
  const stage = opts.stage ?? draw_stage(source, state);
  const bounds = { width: stage.width, height: stage.height };
  const crop = opts.skipCrop ? { x: 0, y: 0, ...bounds } : crop_rect_px(state.crop, bounds);

  const targetWidth = Math.max(1, Math.round((opts.width ?? state.output.width) * scale));
  const targetHeight = Math.max(1, Math.round((opts.height ?? state.output.height) * scale));

  let piece = stage;
  if (crop.width !== bounds.width || crop.height !== bounds.height) {
    piece = make_canvas(crop.width, crop.height);
    context_of(piece).drawImage(stage, -crop.x, -crop.y);
  }

  const reduced = step_down(piece, targetWidth, targetHeight);
  const canvas = make_canvas(targetWidth, targetHeight);
  const ctx = context_of(canvas);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(reduced, 0, 0, targetWidth, targetHeight);

  if (opts.adjust !== false) {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    apply_adjustments(data, state.adjust);
    apply_sharpen(data, state.adjust.sharpen);
    ctx.putImageData(data, 0, 0);
  }

  return canvas;
}

// Source used for the live preview: a one-time downscale keeps every slider
// drag cheap no matter how large the original is.
export function preview_source(image, maxSize) {
  const width = image.naturalWidth ?? image.width;
  const height = image.naturalHeight ?? image.height;
  const longest = Math.max(width, height);
  if (longest <= maxSize) return { canvas: to_canvas(image), scale: 1 };
  const scale = maxSize / longest;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const reduced = step_down(to_canvas(image), targetWidth, targetHeight);
  const sized = make_canvas(targetWidth, targetHeight);
  context_of(sized).drawImage(reduced, 0, 0, targetWidth, targetHeight);
  return { canvas: sized, scale };
}

function to_canvas(image) {
  if (image instanceof HTMLCanvasElement) return image;
  const canvas = make_canvas(image.naturalWidth ?? image.width, image.naturalHeight ?? image.height);
  context_of(canvas).drawImage(image, 0, 0);
  return canvas;
}

export function canvas_to_blob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image"))),
      type,
      quality,
    );
  });
}
