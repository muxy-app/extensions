// What kind of view a file opens in, from its name alone. Kept free of
// CodeMirror imports: the bootstrap uses it to start loading the right chunk.

import { extname } from "@/shared/paths";

const MARKDOWN_EXT = new Set([".md", ".markdown", ".mdx"]);
const HTML_EXT = new Set([".html", ".htm"]);
const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".apng": "image/apng",
};

export const is_markdown = (path) => MARKDOWN_EXT.has(extname(path));
export const is_image = (path) => extname(path) in IMAGE_MIME;
export const image_mime = (path) => IMAGE_MIME[extname(path)] ?? "application/octet-stream";
export const is_svg = (path) => extname(path) === ".svg";
export const is_pdf = (path) => extname(path) === ".pdf";
export const is_html = (path) => HTML_EXT.has(extname(path));

/** "image" | "pdf" | "markdown" | "code" (code also covers SVG and HTML sources). */
export function kind_of(path) {
  if (!path) return null;
  if (is_image(path)) return "image";
  if (is_pdf(path)) return "pdf";
  if (is_markdown(path)) return "markdown";
  return "code";
}

/** Binary kinds are read by their viewer, not through `files.read`. */
export const is_binary_kind = (kind) => kind === "image" || kind === "pdf";
