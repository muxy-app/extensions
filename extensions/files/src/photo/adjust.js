import { build_tone_luts, clamp, hue_matrix, luminance } from "@/lib/photo-math";
import { adjust_is_neutral } from "@/photo/state";

// One pass over the pixels: tone LUT -> saturation/vibrance -> hue -> mono /
// invert. Preview and export run the exact same code, so what the user sees is
// what lands on disk.
export function apply_adjustments(imageData, adjust) {
  if (adjust_is_neutral(adjust)) return imageData;

  const data = imageData.data;
  const { r: lutR, g: lutG, b: lutB } = build_tone_luts(adjust);
  const saturation = 1 + clamp(adjust.saturation ?? 0, -100, 100) / 100;
  const vibrance = clamp(adjust.vibrance ?? 0, -100, 100) / 100;
  const hue = ((adjust.hue ?? 0) % 360 + 360) % 360;
  const matrix = hue === 0 ? null : hue_matrix(hue);
  const grayscale = adjust.grayscale === true;
  const invert = adjust.invert === true;

  for (let i = 0; i < data.length; i += 4) {
    let r = lutR[data[i]];
    let g = lutG[data[i + 1]];
    let b = lutB[data[i + 2]];

    if (matrix) {
      const nr = matrix[0] * r + matrix[1] * g + matrix[2] * b;
      const ng = matrix[3] * r + matrix[4] * g + matrix[5] * b;
      const nb = matrix[6] * r + matrix[7] * g + matrix[8] * b;
      r = nr;
      g = ng;
      b = nb;
    }

    if (vibrance !== 0) {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      // Push flat pixels harder than already-saturated ones.
      const amount = vibrance * (1 - (max - min) / 255);
      const luma = luminance(r, g, b);
      r = luma + (r - luma) * (1 + amount);
      g = luma + (g - luma) * (1 + amount);
      b = luma + (b - luma) * (1 + amount);
    }

    if (saturation !== 1) {
      const luma = luminance(r, g, b);
      r = luma + (r - luma) * saturation;
      g = luma + (g - luma) * saturation;
      b = luma + (b - luma) * saturation;
    }

    if (grayscale) {
      const luma = luminance(r, g, b);
      r = luma;
      g = luma;
      b = luma;
    }

    if (invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  return imageData;
}

// Unsharp-style 3x3 convolution. Skipped at amount 0, which is the default.
export function apply_sharpen(imageData, amount) {
  const strength = clamp(amount ?? 0, 0, 100) / 100;
  if (strength <= 0) return imageData;

  const { width, height, data } = imageData;
  if (width < 3 || height < 3) return imageData;
  const source = new Uint8ClampedArray(data);
  const center = 1 + 4 * strength;
  const side = -strength;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const p = index + channel;
        const value =
          source[p] * center +
          source[p - 4] * side +
          source[p + 4] * side +
          source[p - width * 4] * side +
          source[p + width * 4] * side;
        data[p] = value;
      }
    }
  }

  return imageData;
}
