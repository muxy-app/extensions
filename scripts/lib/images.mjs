import fs from "node:fs";
import path from "node:path";

export const ICON_MIN_DIMENSION = 256;
export const ICON_MAX_SVG_BYTES = 512 * 1024;
export const ICON_MAX_PNG_BYTES = 1024 * 1024;

export const SCREENSHOT_ASPECT_RATIOS = [
  { width: 16, height: 10, label: "16:10" },
  { width: 16, height: 9, label: "16:9" },
];
export const SCREENSHOT_MAX_BYTES = 3 * 1024 * 1024;
export const SCREENSHOT_MAX_COUNT = 6;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function fileExtension(file) {
  return path.extname(file).toLowerCase();
}

export function pngDimensions(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function isSVG(buffer) {
  const head = buffer.toString("utf8", 0, Math.min(buffer.length, 4096)).replace(/^﻿/, "").trimStart();
  if (!head.startsWith("<")) return false;
  return /<svg[\s/>]/i.test(head);
}

export function inspectIcon(absPath) {
  const ext = fileExtension(absPath);
  const errors = [];
  const buffer = fs.readFileSync(absPath);

  if (ext === ".svg") {
    if (!isSVG(buffer)) errors.push("is not a valid SVG file");
    if (buffer.length > ICON_MAX_SVG_BYTES) {
      errors.push(`SVG is ${formatBytes(buffer.length)} (max ${formatBytes(ICON_MAX_SVG_BYTES)})`);
    }
    return { ext, errors };
  }

  if (ext === ".png") {
    const dims = pngDimensions(buffer);
    if (!dims) {
      errors.push("is not a valid PNG file");
    } else if (dims.width !== dims.height) {
      errors.push(`must be square, got ${dims.width}×${dims.height}`);
    } else if (dims.width < ICON_MIN_DIMENSION) {
      errors.push(`must be at least ${ICON_MIN_DIMENSION}×${ICON_MIN_DIMENSION}, got ${dims.width}×${dims.height}`);
    }
    if (buffer.length > ICON_MAX_PNG_BYTES) {
      errors.push(`PNG is ${formatBytes(buffer.length)} (max ${formatBytes(ICON_MAX_PNG_BYTES)})`);
    }
    return { ext, errors };
  }

  errors.push(`unsupported icon format '${ext}' (use .svg or .png)`);
  return { ext, errors };
}

export function inspectScreenshot(absPath) {
  const ext = fileExtension(absPath);
  const errors = [];
  const buffer = fs.readFileSync(absPath);

  if (ext !== ".png") {
    errors.push(`must be a .png file, got '${ext}'`);
    return { ext, errors };
  }

  const dims = pngDimensions(buffer);
  if (!dims) {
    errors.push("is not a valid PNG file");
  } else if (!hasAllowedScreenshotAspectRatio(dims)) {
    errors.push(
      `must use a ${formatAspectRatioList(SCREENSHOT_ASPECT_RATIOS)} aspect ratio, got ${dims.width}×${dims.height}`,
    );
  }
  if (buffer.length > SCREENSHOT_MAX_BYTES) {
    errors.push(`is ${formatBytes(buffer.length)} (max ${formatBytes(SCREENSHOT_MAX_BYTES)})`);
  }
  return { ext, errors };
}

function hasAllowedScreenshotAspectRatio(dims) {
  return SCREENSHOT_ASPECT_RATIOS.some(
    (ratio) => dims.width * ratio.height === dims.height * ratio.width,
  );
}

function formatAspectRatioList(ratios) {
  const labels = ratios.map((ratio) => ratio.label);
  if (labels.length <= 2) return labels.join(" or ");
  return `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
