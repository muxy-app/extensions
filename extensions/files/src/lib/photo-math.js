// Pure geometry/tone helpers for the photo editor. Kept free of DOM and canvas
// APIs so the transforms can be unit-tested with `node --test`.

export const DEG = Math.PI / 180;

export function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return value < min ? min : value > max ? max : value;
}

export function round_to(value, step) {
  return Math.round(value / step) * step;
}

// Wrap to (-180, 180] so 270 and -90 describe the same rotation.
export function normalize_angle(deg) {
  if (!Number.isFinite(deg)) return 0;
  let angle = deg % 360;
  if (angle > 180) angle -= 360;
  if (angle <= -180) angle += 360;
  // -0 reads badly in the numeric field.
  return angle === 0 ? 0 : angle;
}

// Bounding box of a w x h rectangle rotated by `deg` around its centre.
export function rotated_size(width, height, deg) {
  const rad = normalize_angle(deg) * DEG;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
}

// Largest axis-aligned rectangle that stays fully inside a w x h rectangle
// rotated by `deg` — the classic "rotated rect with max area" solution. Used by
// the straighten tool to trim the transparent wedges away in one click.
export function inscribed_size(width, height, deg) {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const rad = normalize_angle(deg) * DEG;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  if (sin < 1e-9 || cos < 1e-9) {
    return sin < 1e-9 ? { width, height } : { width: height, height: width };
  }

  const widthIsLonger = width >= height;
  const long = widthIsLonger ? width : height;
  const short = widthIsLonger ? height : width;

  if (short <= 2 * sin * cos * long || Math.abs(sin - cos) < 1e-9) {
    const half = 0.5 * short;
    return widthIsLonger
      ? { width: half / sin, height: half / cos }
      : { width: half / cos, height: half / sin };
  }

  const cos2 = cos * cos - sin * sin;
  return {
    width: (width * cos - height * sin) / cos2,
    height: (height * cos - width * sin) / cos2,
  };
}

export function rect_center(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function centered_rect(bounds, width, height) {
  return {
    x: (bounds.width - width) / 2,
    y: (bounds.height - height) / 2,
    width,
    height,
  };
}

// Keep a crop rectangle inside the image bounds without changing its size when
// a simple translation is enough.
export function clamp_rect(rect, bounds, minSize = 1) {
  const width = clamp(rect.width, minSize, bounds.width);
  const height = clamp(rect.height, minSize, bounds.height);
  return {
    x: clamp(rect.x, 0, bounds.width - width),
    y: clamp(rect.y, 0, bounds.height - height),
    width,
    height,
  };
}

// Shrink `rect` to `aspect` (width / height) around the given anchor, staying
// inside `bounds`. `null` aspect means free-form.
export function fit_aspect(rect, aspect, bounds, anchor = "center") {
  if (!aspect || aspect <= 0) return clamp_rect(rect, bounds);
  let width = rect.width;
  let height = width / aspect;
  if (height > rect.height) {
    height = rect.height;
    width = height * aspect;
  }
  if (width > bounds.width) {
    width = bounds.width;
    height = width / aspect;
  }
  if (height > bounds.height) {
    height = bounds.height;
    width = height * aspect;
  }

  let x = rect.x;
  let y = rect.y;
  if (anchor === "center") {
    const center = rect_center(rect);
    x = center.x - width / 2;
    y = center.y - height / 2;
  }
  return clamp_rect({ x, y, width, height }, bounds);
}

// Resize maths for the Resize tool: whichever field the user typed wins, the
// other follows when the aspect lock is on.
export function resize_dims({ width, height, sourceWidth, sourceHeight, lock, edited }) {
  const aspect = sourceWidth / sourceHeight;
  let nextWidth = Math.round(clamp(width, 1, 100000));
  let nextHeight = Math.round(clamp(height, 1, 100000));
  if (lock) {
    if (edited === "width") nextHeight = Math.max(1, Math.round(nextWidth / aspect));
    else if (edited === "height") nextWidth = Math.max(1, Math.round(nextHeight * aspect));
  }
  return { width: nextWidth, height: nextHeight };
}

export function scale_dims(sourceWidth, sourceHeight, percent) {
  const factor = clamp(percent, 1, 1000) / 100;
  return {
    width: Math.max(1, Math.round(sourceWidth * factor)),
    height: Math.max(1, Math.round(sourceHeight * factor)),
  };
}

export function fit_scale(sourceWidth, sourceHeight, boxWidth, boxHeight) {
  if (sourceWidth <= 0 || sourceHeight <= 0) return 1;
  return Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
}

// 0-255 tone curve applied per channel before the saturation/hue pass.
// Order mirrors a photo pipeline: exposure -> white balance -> brightness ->
// contrast -> gamma.
export function build_tone_luts(adjust) {
  const exposure = clamp(adjust.exposure ?? 0, -100, 100) / 50; // +/- 2 stops
  const gain = Math.pow(2, exposure);
  const brightness = (clamp(adjust.brightness ?? 0, -100, 100) / 100) * 96;
  const contrast = clamp(adjust.contrast ?? 0, -100, 100);
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const gamma = clamp(adjust.gamma ?? 1, 0.2, 3);
  const temperature = (clamp(adjust.temperature ?? 0, -100, 100) / 100) * 40;
  const tint = (clamp(adjust.tint ?? 0, -100, 100) / 100) * 30;

  const offsets = [temperature + tint * 0.3, -tint, -temperature + tint * 0.3];
  const luts = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];

  for (let channel = 0; channel < 3; channel += 1) {
    const lut = luts[channel];
    const offset = offsets[channel];
    for (let value = 0; value < 256; value += 1) {
      let v = value * gain + offset + brightness;
      v = contrastFactor * (v - 128) + 128;
      if (gamma !== 1) {
        const normalized = clamp(v, 0, 255) / 255;
        v = Math.pow(normalized, 1 / gamma) * 255;
      }
      lut[value] = v;
    }
  }

  return { r: luts[0], g: luts[1], b: luts[2] };
}

export const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 };

export function luminance(r, g, b) {
  return LUMA.r * r + LUMA.g * g + LUMA.b * b;
}

// Hue rotation matrix (same construction the SVG feColorMatrix hueRotate uses).
export function hue_matrix(deg) {
  const rad = (deg % 360) * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    LUMA.r + cos * (1 - LUMA.r) - sin * LUMA.r,
    LUMA.g - cos * LUMA.g - sin * LUMA.g,
    LUMA.b - cos * LUMA.b + sin * (1 - LUMA.b),

    LUMA.r - cos * LUMA.r + sin * 0.143,
    LUMA.g + cos * (1 - LUMA.g) + sin * 0.14,
    LUMA.b - cos * LUMA.b - sin * 0.283,

    LUMA.r - cos * LUMA.r - sin * (1 - LUMA.r),
    LUMA.g - cos * LUMA.g + sin * LUMA.g,
    LUMA.b + cos * (1 - LUMA.b) + sin * LUMA.b,
  ];
}

export function extname_of(path) {
  const name = String(path ?? "").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

// "photos/cat.png" + "png" -> "photos/cat-edited.png" (with -2, -3 … when the
// caller reports the candidate as taken).
export function copy_path_candidate(rel, ext, attempt = 1) {
  const clean = String(rel ?? "").replace(/\/+$/, "");
  const slash = clean.lastIndexOf("/");
  const dir = slash === -1 ? "" : clean.slice(0, slash + 1);
  const name = slash === -1 ? clean : clean.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const suffix = attempt <= 1 ? "-edited" : `-edited-${attempt}`;
  return `${dir}${stem}${suffix}${ext}`;
}

export function replace_ext(rel, ext) {
  const clean = String(rel ?? "").replace(/\/+$/, "");
  const slash = clean.lastIndexOf("/");
  const name = slash === -1 ? clean : clean.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const dir = slash === -1 ? "" : clean.slice(0, slash + 1);
  return `${dir}${stem}${ext}`;
}
